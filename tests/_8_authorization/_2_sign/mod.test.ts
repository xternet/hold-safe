import { expect, test } from "bun:test";
import { getTransactionDecoder } from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import { Clock } from "litesvm";
import { ExitPreparation } from "../../../src/_adapters/_0_solana/_2_execution/_0_prepare/mod";
import { AuthorizationReads } from "../../../src/_adapters/_0_solana/_1_authorize/_0_read/mod";
import { HoldingReads } from "../../../src/_adapters/_0_solana/_0_reader/_1_reads/mod";
import { FeeGate } from "../../../src/_adapters/_0_solana/_shared/_6_fees/mod";
import { buildExit, decodeEnvelope } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { revokeInstruction } from "../../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { authorizationFixture } from "../_shared/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";
import { send } from "../../_2_swap/_1_fixture/_1_accounts/mod";

const limits = { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" };
async function fixture() {
  const f = await authorizationFixture(); f.armBound();
  const log = (fault: Parameters<ConstructorParameters<typeof ExitPreparation>[6]>[0]) => f.faults.push(fault);
  const reads = new AuthorizationReads(f.connection, f.catalog, f.manifest, log, f.now);
  const holdings = new HoldingReads(f.connection, f.catalog, log, f.now), fees = new FeeGate(f.connection, limits);
  const exit = new ExitPreparation(f.connection, reads, holdings, f.route, fees, f.a.keeper, log, f.now);
  const quote = await f.route.venue.quote(f.policy, f.digest); if (!quote.ok) throw new Error(quote.error.message);
  return { ...f, exit, quote: quote.value };
}
test("only an internally built and simulated exit is signed; actual guard swap consumes once", async () => {
  const f = await fixture();
  try {
    const built = await f.exit.build(f.policy, f.quote); expect(built.ok).toBe(true); if (!built.ok) throw new Error(built.error.message);
    expect((await f.exit.signKeeper(f.digest, built.value)).ok).toBe(false);
    const simulated = await f.exit.simulate(built.value); expect(simulated.ok).toBe(true);
    expect(f.state()).toBe(1); expect(f.balances()[2]).toBe(0n);
    const results = await Promise.all([f.exit.signKeeper(f.digest, built.value), f.exit.signKeeper(f.digest, built.value)]);
    expect(results.filter(result => result.ok).length).toBe(1);
    const signed = results.find(result => result.ok); if (signed === undefined || !signed.ok) throw new Error("No signed result");
    expect(signed.value.nativeId.length).toBeGreaterThan(80);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(Buffer.from(signed.value.bytesBase64, "base64"))));
    expect(f.state()).toBe(2); expect(f.balances()[2]!.toString()).toBe(f.native.outputRaw);
    expect((await f.exit.signKeeper(f.digest, built.value)).ok).toBe(false);
  } finally { await f.stop(); }
});
test("unissued, altered and owner-purpose envelopes cannot enter keeper simulation or signing", async () => {
  const f = await fixture();
  try {
    const standalone = buildExit(f.policy, f.digest, f.native, { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 9999, contextSlot: f.batch.slot },
      { ...limits, baseFeeLamports: "5000" });
    expect((await f.exit.simulate(standalone)).ok).toBe(false);
    const built = await f.exit.build(f.policy, f.quote); if (!built.ok) throw new Error(built.error.message);
    const changed = decodeEnvelope(built.value).transaction;
    changed.message.staticAccountKeys[0] = f.a.owner.publicKey;
    for (const envelope of [{ ...built.value, purpose: "arm" as const }, { ...built.value, bytesBase64: Buffer.from(changed.serialize()).toString("base64") },
      { ...built.value, validity: { ...built.value.validity, serialized: "{}" } }]) {
      expect((await f.exit.simulate(envelope)).ok).toBe(false);
      expect((await f.exit.signKeeper(f.digest, envelope)).ok).toBe(false);
    }
    expect((await f.exit.simulate(built.value)).ok).toBe(true);
    expect((await f.exit.signKeeper("00".repeat(32), built.value)).ok).toBe(false);
    const external = VersionedTransaction.deserialize(Buffer.from(built.value.bytesBase64, "base64")); external.sign([f.a.keeper]);
    expect((await f.exit.signKeeper(f.digest, { ...built.value, bytesBase64: Buffer.from(external.serialize()).toString("base64") })).ok).toBe(false);
  } finally { await f.stop(); }
});
test("revocation, post-simulation fee increases and elapsed quote lifetime stop signing", async () => {
  for (const kind of ["revoke", "fee", "expiry"]) {
    const f = await fixture();
    try {
      const built = await f.exit.build(f.policy, f.quote); if (!built.ok) throw new Error(built.error.message);
      expect((await f.exit.simulate(built.value)).ok).toBe(true);
      if (kind === "revoke") assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner));
      if (kind === "fee") f.controls.totalFee = 10001;
      if (kind === "expiry") { const c = f.svm.getClock(); f.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + 3n)); }
      expect((await f.exit.signKeeper(f.digest, built.value)).ok).toBe(false);
      expect(f.state()).toBe(kind === "revoke" ? 3 : 1); expect(f.balances()[2]).toBe(0n);
    } finally { await f.stop(); }
  }
});

test("a genuine failed guard simulation invalidates the issued exit and preserves balances", async () => {
  const f = await fixture();
  try {
    const built = await f.exit.build(f.policy, f.quote); if (!built.ok) throw new Error(built.error.message);
    assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner));
    const simulated = await f.exit.simulate(built.value); expect(simulated.ok).toBe(false);
    if (!simulated.ok) expect(simulated.error.context.logs).toContain("InactivePolicy");
    expect((await f.exit.signKeeper(f.digest, built.value)).ok).toBe(false);
    expect(f.balances()[2]).toBe(0n); expect(f.state()).toBe(3);
  } finally { await f.stop(); }
});
