import { expect, test } from "bun:test";
import { getTransactionDecoder } from "@solana/kit";
import { createApproveCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { createAuthorization } from "../../../src/_adapters/_0_solana/_1_authorize/mod";
import { decodeEnvelope } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { authorizationFixture } from "../_shared/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";
import { send } from "../../_2_swap/_1_fixture/_1_accounts/mod";

const limits = { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" };
test("authorization port previews native rent and builds actual owner-signed arm/revoke transactions", async () => {
  const f = await authorizationFixture();
  const port = createAuthorization(f.connection, f.catalog, f.manifest, limits, f.route, e => f.faults.push(e), f.now);
  try {
    const preview = await port.preview(f.policy); expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.value.allocationRaw).toBe(f.svm.minimumBalanceForRentExemption(579n).toString());
      expect(preview.value.networkFeesRaw).toBe("5000"); expect(preview.value.limitations.length).toBeGreaterThan(0);
    }
    const arm = await port.prepareArm(f.policy, f.digest, { replaceExistingApproval: false }); expect(arm.ok).toBe(true);
    if (!arm.ok) throw new Error(arm.error.message);
    const transaction = decodeEnvelope(arm.value).transaction; transaction.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize())));
    const state = await port.read(f.policy); expect(state.ok && state.value.state).toBe("active");
    const revoke = await port.prepareRevoke(f.policy); expect(revoke.ok).toBe(true);
    if (!revoke.ok) throw new Error(revoke.error.message);
    const cancellation = decodeEnvelope(revoke.value).transaction; cancellation.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(cancellation.serialize())));
    const revoked = await port.read(f.policy); expect(revoked.ok && revoked.value.state).toBe("revoked");
  } finally { await f.stop(); }
});
test("arming cannot silently replace delegation or accept a mismatched policy digest", async () => {
  const f = await authorizationFixture();
  const port = createAuthorization(f.connection, f.catalog, f.manifest, limits, f.route, e => f.faults.push(e), f.now);
  try {
    assertSuccess(send(f.svm, [createApproveCheckedInstruction(f.a.source, new PublicKey(f.policy.input.address), f.a.delegate.publicKey,
      f.a.owner.publicKey, f.a.amount, 8, [], TOKEN_2022_PROGRAM_ID)], f.a.owner));
    expect((await port.preview(f.policy)).ok).toBe(true);
    expect((await port.prepareArm(f.policy, f.digest, { replaceExistingApproval: false })).ok).toBe(false);
    expect((await port.prepareArm(f.policy, "00".repeat(32), { replaceExistingApproval: true })).ok).toBe(false);
    const armed = await port.prepareArm(f.policy, f.digest, { replaceExistingApproval: true }); expect(armed.ok).toBe(true);
    if (!armed.ok) throw new Error(armed.error.message);
    const transaction = decodeEnvelope(armed.value).transaction; transaction.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize())));
    expect(f.state()).toBe(1);
  } finally { await f.stop(); }
});
