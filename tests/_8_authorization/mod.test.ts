import { expect, test } from "bun:test";
import { Clock } from "litesvm";
import { AuthorizationReads } from "../../src/_adapters/_0_solana/_1_authorize/_0_read/mod";
import { revokeInstruction, executeInstruction } from "../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { send } from "../_2_swap/_1_fixture/_1_accounts/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";
import { authorizationFixture } from "./_shared/mod";

test("authorization reader binds actual guard state, PDA authority and coherent source time", async () => {
  const f = await authorizationFixture();
  const reader = new AuthorizationReads(f.connection, f.catalog, f.manifest, e => f.faults.push(e), f.now);
  try {
    const absent = await reader.read(f.policy); expect(absent.ok && absent.value.state).toBe("absent");
    f.armBound();
    const active = await reader.read(f.policy);
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.value.state).toBe("active"); expect(active.value.policyDigest).toBe(f.digest);
      expect(active.value.delegate).toBe(f.a.policy.toBase58()); expect(active.value.remainingRaw).toBe(f.policy.amountRaw);
      expect(active.value.sourceAtMs).toBe(f.now());
    }
    expect((await reader.read({ ...f.policy, amountRaw: "1" })).ok).toBe(false);
    assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner));
    const revoked = await reader.read(f.policy); expect(revoked.ok && revoked.value.state).toBe("revoked");
  } finally { await f.stop(); }
});
test("authorization recognizes real consumption and expiry without pretending missing state is active", async () => {
  for (const action of ["consume", "expire"]) {
    const f = await authorizationFixture();
    const reader = new AuthorizationReads(f.connection, f.catalog, f.manifest, e => f.faults.push(e), f.now);
    try {
      f.armBound();
      if (action === "consume") assertSuccess(send(f.svm, [executeInstruction(f.policy, f.native)], f.a.keeper));
      else {
        const old = f.svm.getClock(); f.svm.setClock(new Clock(old.slot, old.epochStartTimestamp, old.epoch, old.leaderScheduleEpoch, BigInt(f.policy.expiresAt)));
      }
      const state = await reader.read(f.policy); expect(state.ok).toBe(true);
      if (state.ok) { expect(state.value.state).toBe(action === "consume" ? "consumed" : "expired"); expect(state.value.remainingRaw).toBe("0"); }
    } finally { await f.stop(); }
  }
});
test("guard binary changes in the same slot, authority changes and wrong RPC domains disable reads", async () => {
  const f = await authorizationFixture();
  const reader = new AuthorizationReads(f.connection, f.catalog, f.manifest, e => f.faults.push(e), f.now);
  try {
    f.armBound(); expect((await reader.read(f.policy)).ok).toBe(true);
    const original = f.get(f.manifest.programData);
    for (const change of [
      (data: Buffer) => { data[100] = data[100]! ^ 1; },
      (data: Buffer) => { data[12] = 1; f.a.owner.publicKey.toBuffer().copy(data, 13); },
      (data: Buffer) => { data.writeBigUInt64LE(data.readBigUInt64LE(4) + 1n, 4); },
    ]) {
      const data = Buffer.from(original.data); change(data); f.svm.setAccount({ ...original, data });
      expect((await reader.read(f.policy)).ok).toBe(false); f.svm.setAccount(original);
    }
    f.controls.status = 429; expect((await reader.read(f.policy)).ok).toBe(false);
    expect(JSON.stringify(f.faults)).not.toContain("private-provider-message");
    f.controls.status = 200; f.controls.genesis = "wrong";
    const foreign = new AuthorizationReads(f.connection, f.catalog, f.manifest, e => f.faults.push(e), f.now);
    expect((await foreign.read(f.policy)).ok).toBe(false);
  } finally { await f.stop(); }
});
