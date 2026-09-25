import { expect, test } from "bun:test";
import { Clock } from "litesvm";
import { deliveryFixture } from "./_shared/mod";
import { revokeInstruction } from "../../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { send } from "../../_2_swap/_1_fixture/_1_accounts/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";

const value = <T>(outcome: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!outcome.ok) throw new Error(outcome.error.message); return outcome.value;
};
test("RPC acceptance stays pending until two finalized receipts prove actual guard consumption and token deltas", async () => {
  const f = await deliveryFixture();
  try {
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("pending");
    expect(value(await f.delivery.broadcast(f.signed)).accepted).toBe(true);
    expect(f.state()).toBe(2); expect(f.sends()).toBe(1);
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("pending");
    f.controls.forEach(c => c.finality = "finalized");
    const receipt = value(await f.delivery.reconcile(f.signed));
    expect(receipt.state).toBe("confirmed");
    const proof = JSON.parse(receipt.context.serialized);
    expect(proof.proof.inputRaw).toBe(f.policy.amountRaw); expect(proof.proof.outputRaw).toBe(f.native.outputRaw);
    expect((await f.delivery.broadcast(f.signed)).ok).toBe(false); expect(f.sends()).toBe(1);
  } finally { await f.stop(); }
});
test("lost send response recovers the existing signature without another swap", async () => {
  const f = await deliveryFixture();
  try {
    f.controls[0]!.loseSend = true;
    expect((await f.delivery.broadcast(f.signed)).ok).toBe(false); expect(f.state()).toBe(2);
    f.controls.forEach(c => c.finality = "finalized");
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("confirmed"); expect(f.sends()).toBe(1);
    expect(JSON.stringify(f.faults)).not.toContain("response lost after execution");
  } finally { await f.stop(); }
});
test("missing, conflicting or unavailable RPC evidence stays unknown even after blockhash expiry", async () => {
  const f = await deliveryFixture();
  try {
    assertSuccess(f.execute()); f.controls.forEach(c => c.finality = "finalized");
    for (const kind of ["absent", "missingTransaction", "alteredOutput", "http", "genesis"] as const) {
      const b = f.controls[1]!, original = b[kind];
      if (kind === "http") b.http = 429; else if (kind === "genesis") b.genesis = "foreign"; else b[kind] = true;
      expect(value(await f.delivery.reconcile(f.signed)).state).toBe("unknown");
      Object.assign(b, { [kind]: original });
    }
    f.controls.forEach(c => { c.absent = true; c.validHash = false; }); f.controls[0]!.http = 200;
    f.setHeight(1151);
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("unknown");
  } finally { await f.stop(); }
});
test("expiry requires both finalized invalid blockhashes and unconsumed policy; actual failed transaction is terminal", async () => {
  const f = await deliveryFixture();
  try {
    // Height alone, or just one provider's invalid hash, cannot release a retry.
    f.setHeight(1151);
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("unknown");
    f.controls[0]!.validHash = false;
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("unknown");
    f.controls[1]!.validHash = false;
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("expired");
    f.setHeight(1000); f.controls.forEach(c => c.validHash = true);
    assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner));
    f.execute(); f.controls.forEach(c => c.finality = "finalized");
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("failed"); expect(f.balances()[2]).toBe(0n);
  } finally { await f.stop(); }
});
test("expired quotes cannot be broadcast but remain reconcilable", async () => {
  const f = await deliveryFixture();
  try {
    const c = f.svm.getClock(); f.svm.setClock(new Clock(c.slot, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + 3n));
    expect((await f.delivery.broadcast(f.signed)).ok).toBe(false); expect(f.sends()).toBe(0);
    expect(value(await f.delivery.reconcile(f.signed)).state).toBe("pending");
  } finally { await f.stop(); }
});
