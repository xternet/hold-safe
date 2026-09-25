import { expect, test } from "bun:test";
import { createExecution } from "../../../src/_adapters/_0_solana/_2_execution/mod";
import { AuthorizationReads } from "../../../src/_adapters/_0_solana/_1_authorize/_0_read/mod";
import { HoldingReads } from "../../../src/_adapters/_0_solana/_0_reader/_1_reads/mod";
import { createJournal } from "../../../src/_shared/_0_store/mod";
import { armed, expire, journalFixture, preparation } from "../../_5_storage/_shared/mod";
import { deliveryFixture } from "../_3_delivery/_shared/mod";

test("actual signed guard exit survives journal reconnect and lost send response without a second swap", async () => {
  const f = await deliveryFixture(), db = await journalFixture();
  try {
    const log = f.options.log;
    const execution = createExecution(f.options, { keeper: f.a.keeper, route: f.route,
      authorization: new AuthorizationReads(f.connection, f.catalog, f.manifest, log, f.now),
      holdings: new HoldingReads(f.connection, f.catalog, log, f.now) });
    const quote = await f.route.venue.quote(f.policy, f.digest); if (!quote.ok) throw new Error(quote.error.message);
    const built = await execution.build(f.policy, quote.value); if (!built.ok) throw new Error(built.error.message);
    const simulation = await execution.simulate(built.value); if (!simulation.ok) throw new Error(simulation.error.message);
    const signed = await execution.signKeeper(f.digest, built.value); if (!signed.ok) throw new Error(signed.error.message);
    const first = db.open(), store = createJournal(first.sql, f.catalog, log);
    const { claim } = await armed(store, "before-crash", f.policy);
    // Synthetic trigger label; actual signed bytes and SVM simulation evidence.
    const plan = await preparation(f.policy); plan.signed = signed.value; plan.execution = simulation.value.context;
    await store.prepare(claim, plan); expect(f.sends()).toBe(0); expect(f.state()).toBe(1);
    await first.sql.close(); await expire(db.admin, claim);
    const restarted = createJournal(db.open().sql, f.catalog, log);
    const next = await restarted.claim(f.digest, "after-crash", 10000); if (next === null) throw new Error("No recovery claim");
    const recovered = await restarted.latest(f.digest); if (recovered === null) throw new Error("Signed attempt lost");
    expect(recovered.signed).toEqual(signed.value);
    f.controls[0]!.loseSend = true;
    expect((await execution.broadcast(recovered.signed)).ok).toBe(false);
    expect(f.sends()).toBe(1); expect(f.state()).toBe(2);
    f.controls.forEach(c => c.finality = "finalized");
    const receipt = await execution.reconcile(recovered.signed); if (!receipt.ok) throw new Error(receipt.error.message);
    expect(receipt.value.state).toBe("confirmed");
    await restarted.receipt(next, recovered.id, receipt.value);
    expect((await restarted.readPolicy(f.digest))!.state).toBe("CONFIRMED");
    expect((await restarted.latest(f.digest))!.signed.nativeId).toBe(signed.value.nativeId);
    await expect(restarted.prepare(next, plan)).rejects.toThrow();
    expect(f.balances()[2]!.toString()).toBe(f.native.outputRaw); expect(f.sends()).toBe(1);
  } finally { await db.close(); await f.stop(); }
});
