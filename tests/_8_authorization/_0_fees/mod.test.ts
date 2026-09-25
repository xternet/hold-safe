import { expect, test } from "bun:test";
import { lamports } from "@solana/kit";
import { FeeGate } from "../../../src/_adapters/_0_solana/_shared/_6_fees/mod";
import { buildExit } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { authorizationFixture } from "../_shared/mod";

test("fee preparation reads base fee and enforces actual total fee, balance and block validity", async () => {
  const f = await authorizationFixture();
  const gate = new FeeGate(f.connection, { computeUnitLimit: 1000000, microLamports: "1000", maxFeeLamports: "7000" });
  try {
    f.controls.baseFee = 5500; f.controls.totalFee = 6500;
    const prepared = await gate.prepare(f.a.keeper.publicKey);
    expect(prepared.fees.baseFeeLamports).toBe("5500");
    const envelope = buildExit(f.policy, f.digest, f.native, prepared.validity, prepared.fees);
    expect((await gate.check(envelope)).feeLamports).toBe("6500");
    f.controls.totalFee = 7001; await expect(gate.check(envelope)).rejects.toThrow(/fee cap/);
    f.controls.totalFee = 6500; f.controls.feeMissing = true;
    await expect(gate.check(envelope)).rejects.toThrow(); f.controls.feeMissing = false;
    f.controls.blockHeight = prepared.validity.lastValidBlockHeight + 1;
    await expect(gate.check(envelope)).rejects.toThrow(/expired/);
    f.controls.blockHeight = 1000;
    const keeper = f.get(f.policy.keeper); f.svm.setAccount({ ...keeper, lamports: lamports(6499n) });
    await expect(gate.check(envelope)).rejects.toThrow(/balance/);
  } finally { await f.stop(); }
});
test("fee gate rejects unsupported RPC domain and counts account allocation separately", async () => {
  const f = await authorizationFixture();
  const gate = new FeeGate(f.connection, { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" });
  try {
    const prepared = await gate.prepare(f.a.owner.publicKey);
    const envelope = buildExit(f.policy, f.digest, f.native, prepared.validity, prepared.fees);
    const balance = f.get(f.policy.keeper).lamports;
    await expect(gate.check(envelope, balance.toString())).rejects.toThrow(/balance/);
    f.controls.genesis = "foreign";
    const foreign = new FeeGate(f.connection, { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" });
    await expect(foreign.prepare(f.a.owner.publicKey)).rejects.toThrow(/mainnet/);
  } finally { await f.stop(); }
});
