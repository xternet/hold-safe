import { expect, test } from "bun:test";
import { workerFixture } from "./_shared/mod";
import { revokeInstruction } from "../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";
import { send } from "../_2_swap/_1_fixture/_1_accounts/mod";

test("two workers evaluate actual risk and produce one journaled native exit without a browser", async () => {
  const f = await workerFixture();
  try {
    const a = f.worker("worker-a"), b = f.worker("worker-b");
    await Promise.all([a.tick(), b.tick()]);
    for (let i = 0; i < 3; i++) { await f.advance(); await Promise.all([a.tick(), b.tick()]); }
    expect(f.sends()).toBe(1); expect(f.state()).toBe(2);
    expect((await f.journal.latest(f.digest))!.state).toBe("SUBMITTED");
    f.controls.forEach(c => c.finality = "finalized"); await Promise.all([a.tick(), b.tick()]);
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("CONFIRMED");
    expect((await f.db.admin`select id from solstock_guard.attempts`).length).toBe(1);
    const decisions = await f.db.admin`select evidence from solstock_guard.decisions order by created_at`;
    expect(decisions.some((d: any) => d.evidence.decision.state === "PENDING")).toBe(true);
    const triggered = decisions.find((d: any) => d.evidence.decision.state === "TRIGGERED");
    expect(triggered).toBeDefined();
    const saved = JSON.parse(triggered!.evidence.execution.serialized);
    expect(saved.detail.snapshot.reference.value.bidUsd.n).toBe("1000");
    expect(saved.detail.snapshot.quote.value.policyDigest).toBe(f.digest);
    expect(a.health().active + b.health().active).toBe(0);
  } finally { await f.close(); }
}, 15000);

test("restart resets persistence and a later feed gap restarts the required observation window", async () => {
  const f = await workerFixture();
  try {
    const first = f.worker("before-restart"); await first.tick(); await f.advance(); await first.tick(); await f.advance(); await first.tick();
    await first.stop(); const next = f.worker("after-restart"); await next.tick();
    await f.advance(); await next.tick(); expect(f.sends()).toBe(0);
    for (const listeners of f.prices.values()) for (const observer of listeners) observer({ ok: false,
      error: { code: "UNAVAILABLE", message: "Controlled disconnect", retryable: true, context: {} } });
    await f.advance(); await next.tick();
    for (let i = 0; i < 2; i++) { await f.advance(); await next.tick(); expect(f.sends()).toBe(0); }
    await f.advance(); await next.tick(); expect(f.sends()).toBe(1);
  } finally { await f.close(); }
}, 15000);

test("database rejection before committed intent prevents every broadcast", async () => {
  const f = await workerFixture();
  try {
    await f.db.admin.unsafe(`CREATE FUNCTION solstock_guard.test_no_prepare() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Controlled storage failure'; END $$;
      CREATE TRIGGER test_no_prepare BEFORE INSERT ON solstock_guard.attempts FOR EACH ROW EXECUTE FUNCTION solstock_guard.test_no_prepare();`);
    const worker = f.worker("db-failure"); await worker.tick();
    for (let i = 0; i < 3; i++) { await f.advance(); await worker.tick(); }
    expect(f.sends()).toBe(0); expect(f.state()).toBe(1); expect(worker.health().healthy).toBe(false);
    expect((await f.db.admin`select id from solstock_guard.attempts`).length).toBe(0);
  } finally { await f.close(); }
}, 15000);

test("crash-like failure after send recovers the original prepared attempt before reading feeds", async () => {
  const f = await workerFixture();
  try {
    await f.db.admin.unsafe(`CREATE FUNCTION solstock_guard.test_no_submitted() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.state='SUBMITTED' THEN RAISE EXCEPTION 'Controlled failure after send'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_no_submitted BEFORE UPDATE ON solstock_guard.attempts FOR EACH ROW EXECUTE FUNCTION solstock_guard.test_no_submitted();`);
    const before = f.worker("before-send-failure"); await before.tick();
    for (let i = 0; i < 3; i++) { await f.advance(); await before.tick(); }
    expect(f.sends()).toBe(1); expect((await f.journal.latest(f.digest))!.state).toBe("PREPARED");
    await before.stop(); f.controls.forEach(c => c.finality = "finalized");
    const after = f.worker("after-send-failure"); await after.tick();
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("CONFIRMED"); expect(f.sends()).toBe(1);
    expect([...f.prices.values()].every(listeners => listeners.size === 0)).toBe(true);
  } finally { await f.close(); }
}, 15000);

test("owner revocation cancels monitoring without an attempted exit", async () => {
  const f = await workerFixture();
  try {
    const worker = f.worker("revocation"); await worker.tick();
    assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner)); await worker.tick();
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("REVOKED"); expect(f.sends()).toBe(0); expect(worker.health().active).toBe(0);
  } finally { await f.close(); }
});


test("foreground worker loop discovers policies and abort waits for complete subscription and claim cleanup", async () => {
  const f = await workerFixture(), controller = new AbortController(), worker = f.worker("foreground-loop");
  const running = worker.run(controller.signal);
  try {
    let recorded = false;
    for (let i = 0; i < 100; i++) {
      const decisions = await f.db.admin`select id from solstock_guard.decisions`;
      if (decisions.length > 0) { recorded = true; break; }
      await Bun.sleep(10);
    }
    expect(recorded).toBe(true); expect(worker.health().active).toBe(1);
    controller.abort(); await running;
    expect(worker.health().active).toBe(0);
    expect([...f.prices.values()].every(listeners => listeners.size === 0)).toBe(true);
    const claims = await f.db.admin`select policy_id from solstock_guard.policy_claims where lease_until>clock_timestamp()`;
    expect(claims.length).toBe(0); expect(f.sends()).toBe(0);
  } finally { controller.abort(); await running; await f.close(); }
});


test("expired worker claim discards its old risk history before another worker starts", async () => {
  const f = await workerFixture();
  try {
    const old = f.worker("expired-owner"); await old.tick(); await f.advance(); await old.tick(); await f.advance(); await old.tick();
    await f.db.admin`update solstock_guard.policy_claims set lease_until=clock_timestamp()-interval '1 second' where policy_id=${f.digest}`;
    await old.tick(); expect(old.health().healthy).toBe(false); expect(old.health().active).toBe(0);
    const next = f.worker("new-owner"); await next.tick();
    for (let i = 0; i < 2; i++) { await f.advance(); await next.tick(); expect(f.sends()).toBe(0); }
    await f.advance(); await next.tick(); expect(f.sends()).toBe(1);
  } finally { await f.close(); }
}, 15000);


test("feed gap or cleared reference condition during real simulation prevents signing and broadcast", async () => {
  for (const mode of ["gap", "clear"] as const) {
    const f = await workerFixture();
    try {
      const worker = f.worker(`during-simulation-${mode}`, () => {
        for (const observer of f.prices.get(f.policy.coverage.inputReference.provider)!) {
          if (mode === "gap") observer({ ok: false, error: { code: "UNAVAILABLE", message: "Controlled gap during simulation", retryable: true, context: {} } });
          else observer({ ok: true, value: { ...f.policy.coverage.inputReference, id: "controlled-clearing-price", sourceAtMs: f.now(), receivedAtMs: f.now(),
            bidUsd: { n: 1n, d: 1n }, askUsd: { n: 1n, d: 1n }, bidSize: { n: 100n, d: 1n }, askSize: { n: 100n, d: 1n }, sizeUnit: "round_lots", session: "regular" } });
        }
      });
      await worker.tick(); for (let i = 0; i < 3; i++) { await f.advance(); await worker.tick(); }
      expect(f.sends()).toBe(0); expect(f.state()).toBe(1);
      expect((await f.db.admin`select id from solstock_guard.attempts`).length).toBe(0);
      expect(worker.health().healthy).toBe(false);
    } finally { await f.close(); }
  }
}, 15000);


test("risk invalidation after committed intent leaves an unresolved attempt that restart never rebroadcasts", async () => {
  const f = await workerFixture();
  try {
    // The test callback runs after the real database commit; it changes feed
    // input, never replaces persistence, simulation or native execution.
    const worker = f.worker("post-commit-gap", undefined, () => {
      for (const observer of f.prices.get(f.policy.coverage.inputReference.provider)!) observer({ ok: false,
        error: { code: "UNAVAILABLE", message: "Controlled post-commit gap", retryable: true, context: {} } });
    });
    await worker.tick(); for (let i = 0; i < 3; i++) { await f.advance(); await worker.tick(); }
    expect(f.sends()).toBe(0); expect((await f.journal.latest(f.digest))!.state).toBe("UNKNOWN");
    await worker.stop(); const restarted = f.worker("post-gap-recovery"); await restarted.tick();
    expect(f.sends()).toBe(0); expect((await f.journal.latest(f.digest))!.state).toBe("UNKNOWN");
    expect((await f.db.admin`select id from solstock_guard.attempts`).length).toBe(1);
    expect([...f.prices.values()].every(listeners => listeners.size === 0)).toBe(true);
  } finally { await f.close(); }
}, 15000);


test("an unsigned arming request expires only after a fresh native absence check", async () => {
  const f = await workerFixture(false);
  try {
    const worker = f.worker("unsubmitted-arm"); await worker.tick();
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("UNAVAILABLE");
    await f.advance(3601); await worker.tick();
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("EXPIRED");
    expect(worker.health().active).toBe(0); expect(f.sends()).toBe(0);
  } finally { await f.close(); }
});
