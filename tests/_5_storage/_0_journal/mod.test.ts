import { expect, test } from "bun:test";
import { copyValue, type Receipt } from "../../../src/_kernel/mod";
import { policyFixture } from "../../../src/_kernel/_test/mod";
import { armed, expire, journalFixture, preparation } from "../_shared/mod";

test("journal commits exact bytes and evidence before send and recovers them after reconnect", async () => {
  const f = await journalFixture();
  try {
    const first = f.open(), { claim, policy } = await armed(first.journal), plan = await preparation(policy);
    const saved = await first.journal.prepare(claim, plan);
    expect(saved.state).toBe("PREPARED"); expect(saved.signed).toEqual(plan.signed);
    await first.sql.end();
    const restarted = f.open();
    expect(await restarted.journal.latest(claim.policyDigest)).toEqual(saved);
    const [decision] = await f.admin`select evidence from solstock_guard.decisions where id=${plan.decisionId}`;
    expect(decision!.evidence.decision.evidence.shares.n).toBe("9007199254740993");
    expect(decision!.evidence.execution).toEqual(plan.execution);
    await expect(f.admin`update solstock_guard.decisions set reason='rewritten' where id=${plan.decisionId}`.execute()).rejects.toThrow();
    expect((await restarted.journal.readPolicy(claim.policyDigest))!.state).toBe("TRIGGERED");
    await expect(restarted.journal.prepare(claim, await preparation(policy))).rejects.toThrow();
    expect((await f.admin`select id from solstock_guard.attempts`).length).toBe(1);
  } finally { await f.close(); }
});

test("database claims fence concurrent and expired workers without deleting fence history", async () => {
  const f = await journalFixture();
  try {
    const a = f.open().journal, b = f.open().journal, policy = await a.putPolicy(policyFixture());
    const results = await Promise.all([a.claim(policy.digest, "a", 10_000), b.claim(policy.digest, "b", 10_000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results.find(x => x !== null)!;
    await expire(f.admin, winner);
    await expect(a.renew(winner, 10_000)).rejects.toThrow();
    const next = await b.claim(policy.digest, "next", 10_000);
    expect(next).not.toBeNull(); expect(BigInt(next!.fence)).toBe(BigInt(winner.fence) + 1n);
    await expect(a.release(winner)).rejects.toThrow();
    await expect(a.transition(winner, "DRAFT", "ARMING", { adapter: "test", version: 1, serialized: "{}" })).rejects.toThrow();
    await b.release(next!);
    const last = await a.claim(policy.digest, "last", 10_000);
    expect(BigInt(last!.fence)).toBe(BigInt(next!.fence) + 1n);
    expect(f.faults.length).toBeGreaterThanOrEqual(3);
  } finally { await f.close(); }
});

test("receipt transitions preserve uncertainty and terminal results; retry lineage is explicit", async () => {
  const f = await journalFixture();
  try {
    const journal = f.open().journal, { claim, policy, evidence } = await armed(journal), plan = await preparation(policy);
    await journal.prepare(claim, plan);
    await journal.receipt(claim, plan.id, { nativeId: plan.signed.nativeId, state: "pending", checkedAtMs: Date.now(), context: evidence });
    expect((await journal.latest(claim.policyDigest))!.state).toBe("PREPARED");
    await journal.submitted(claim, plan.id);
    expect((await journal.latest(claim.policyDigest))!.state).toBe("SUBMITTED");
    const receipt: Receipt = { nativeId: plan.signed.nativeId, state: "unknown", checkedAtMs: Date.now(), context: evidence };
    await journal.receipt(claim, plan.id, receipt);
    expect((await journal.latest(claim.policyDigest))!.state).toBe("UNKNOWN");
    await expect(journal.transition(claim, "UNAVAILABLE", "ARMED", evidence)).rejects.toThrow();
    await expect(journal.prepare(claim, await preparation(policy))).rejects.toThrow();
    await expect(journal.receipt(claim, plan.id, { ...receipt, nativeId: "wrong", state: "confirmed" })).rejects.toThrow();
    await journal.receipt(claim, plan.id, { ...receipt, state: "expired" });
    await journal.transition(claim, "FAILED", "ARMED", evidence);
    const retry = await preparation(policy);
    await expect(journal.prepare(claim, retry)).rejects.toThrow();
    retry.previousId = plan.id; await journal.prepare(claim, retry);
    await journal.receipt(claim, retry.id, { ...receipt, nativeId: retry.signed.nativeId, state: "confirmed" });
    expect((await journal.readPolicy(claim.policyDigest))!.state).toBe("CONFIRMED");
    await expect(journal.submitted(claim, retry.id)).rejects.toThrow();
    await expect(journal.receipt(claim, retry.id, { ...receipt, nativeId: retry.signed.nativeId })).rejects.toThrow();
    await expect(journal.transition(claim, "CONFIRMED", "ARMED", evidence)).rejects.toThrow();
  } finally { await f.close(); }
});

test("prepare is atomic, rejects changed domains and decisions, and rolls back competing work", async () => {
  const f = await journalFixture();
  try {
    const a = f.open().journal, b = f.open().journal, { claim, policy } = await armed(a), plan = await preparation(policy);
    for (const mutation of [
      (p: typeof plan) => { p.signed.chain.reference = "foreign-network"; },
      (p: typeof plan) => { p.decision.policyDigest = "00".repeat(32); },
      (p: typeof plan) => { p.decision.state = "CLEAR"; },
      (p: typeof plan) => { p.signed.bytesBase64 = "not base64"; },
    ]) { const invalid = copyValue(plan); mutation(invalid); await expect(a.prepare(claim, invalid)).rejects.toThrow(); }
    const concurrent = await Promise.allSettled([a.prepare(claim, plan), b.prepare(claim, await preparation(policy))]);
    expect(concurrent.filter(x => x.status === "fulfilled")).toHaveLength(1);
    expect((await f.admin`select id from solstock_guard.decisions`).length).toBe(1);
    expect((await f.admin`select id from solstock_guard.attempts`).length).toBe(1);
    expect((await f.admin`select sequence from solstock_guard.events where kind='ATTEMPT_PREPARED'`).length).toBe(1);
    const duplicate = await a.putPolicy(policy);
    expect(duplicate.digest).toBe(claim.policyDigest); expect(duplicate.state).toBe("TRIGGERED");
    await expect(f.admin`update solstock_guard.policies set document=jsonb_set(document,'{amountRaw}','"999"') where id=${claim.policyDigest}`.execute()).rejects.toThrow();
  } finally { await f.close(); }
});


test("restart scan pages active policies without drafts or completed exits", async () => {
  const f = await journalFixture();
  try {
    const journal = f.open().journal, active: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const policy = policyFixture(); policy.source = `source-${i}`; policy.orderId = String(i).padStart(64, "0");
      if (i === 4) { await journal.putPolicy(policy); continue; }
      const { claim } = await armed(journal, "worker", policy);
      if (i === 3) {
        const plan = await preparation(policy); await journal.prepare(claim, plan);
        await journal.receipt(claim, plan.id, { nativeId: plan.signed.nativeId, state: "confirmed", checkedAtMs: Date.now(), context: plan.execution });
      } else active.push(claim.policyDigest);
    }
    const restarted = f.open().journal;
    const first = await restarted.scanActive(null, 1);
    const second = await restarted.scanActive(first[0]!.digest, 1);
    expect([...first, ...second].map(p => p.digest)).toEqual(active.sort());
    expect(await restarted.scanActive(second[0]!.digest, 1)).toEqual([]);
    await expect(restarted.scanActive(null, 0)).rejects.toThrow();
    await expect(restarted.scanActive(null, 129)).rejects.toThrow();
  } finally { await f.close(); }
});
