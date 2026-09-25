import { workflowFixture } from "./_shared/mod";
import { expect, test } from "bun:test";
import { getTransactionDecoder } from "@solana/kit";
import { decodeEnvelope } from "../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { preparation } from "../_5_storage/_shared/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";


test("owner workflow previews, reserves unsigned arm and observes actual owner arm/revoke", async () => {
  const f = await workflowFixture();
  try {
    const preview = await f.workflow.preview(f.policy.owner, f.policy);
    expect(preview.ok).toBe(true);
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("DRAFT");
    const arm = await f.workflow.arm(f.policy.owner, f.digest, { replaceExistingApproval: false });
    expect(arm.ok).toBe(true); if (!arm.ok) throw new Error(arm.error.message);
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("ARMING");
    const before = await f.workflow.status(f.policy.owner, f.digest);
    expect(before.ok && before.value.authorization.ok && before.value.authorization.value.state).toBe("absent");
    const tx = decodeEnvelope(arm.value).transaction; tx.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(tx.serialize())));
    const active = await f.workflow.status(f.policy.owner, f.digest);
    expect(active.ok && active.value.authorization.ok && active.value.authorization.value.state).toBe("active");
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("ARMING");
    const claim = await f.journal.claim(f.digest, "busy-worker", 60000);
    expect(claim).not.toBeNull();
    if (claim === null || !active.ok || !active.value.authorization.ok) throw new Error("Missing active fixture claim/state");
    await f.journal.transition(claim, "ARMING", "ARMED", active.value.authorization.value.context);
    // Synthetic journal-only intent tests filtering; no synthetic bytes are sent.
    const intent = await preparation(f.policy); await f.journal.prepare(claim, intent);
    const pending = await f.workflow.status(f.policy.owner, f.digest);
    expect(pending.ok && pending.value.attempt?.nativeId).toBe(intent.signed.nativeId);
    expect(JSON.stringify(pending)).not.toContain(intent.signed.bytesBase64);
    const revoke = await f.workflow.revoke(f.policy.owner, f.digest);
    expect(revoke.ok).toBe(true); if (!revoke.ok) throw new Error(revoke.error.message);
    const cancellation = decodeEnvelope(revoke.value).transaction; cancellation.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(cancellation.serialize())));
    const revoked = await f.workflow.status(f.policy.owner, f.digest);
    expect(revoked.ok && revoked.value.authorization.ok && revoked.value.authorization.value.state).toBe("revoked");
    expect(JSON.stringify(revoked)).not.toContain("bytesBase64");
    if (claim !== null) await f.journal.release(claim);
  } finally { await f.close(); }
});

test("foreign owner, keeper changes and active worker claims cannot produce arm authorization", async () => {
  const f = await workflowFixture();
  try {
    expect((await f.workflow.preview(f.policy.keeper, f.policy)).ok).toBe(false);
    expect((await f.workflow.preview(f.policy.owner, { ...f.policy, keeper: f.policy.owner })).ok).toBe(false);
    expect(await f.journal.readPolicy(f.digest)).toBeNull();
    expect((await f.workflow.preview(f.policy.owner, f.policy)).ok).toBe(true);
    for (const action of [() => f.workflow.arm(f.policy.keeper, f.digest, { replaceExistingApproval: false }),
      () => f.workflow.status(f.policy.keeper, f.digest), () => f.workflow.revoke(f.policy.keeper, f.digest)]) {
      expect((await action()).ok).toBe(false);
    }
    const claim = await f.journal.claim(f.digest, "other-worker", 60000);
    expect((await f.workflow.arm(f.policy.owner, f.digest, { replaceExistingApproval: false })).ok).toBe(false);
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("DRAFT");
    if (claim !== null) await f.journal.release(claim);
  } finally { await f.close(); }
});

test("database admission failure never returns an unsigned arm transaction", async () => {
  const f = await workflowFixture();
  try {
    expect((await f.workflow.preview(f.policy.owner, f.policy)).ok).toBe(true);
    await f.db.admin.unsafe(`CREATE FUNCTION solstock_guard.reject_arm() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.state='ARMING' THEN RAISE EXCEPTION 'fixture admission failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_arm BEFORE UPDATE ON solstock_guard.policies FOR EACH ROW EXECUTE FUNCTION solstock_guard.reject_arm();`);
    const arm = await f.workflow.arm(f.policy.owner, f.digest, { replaceExistingApproval: false });
    expect(arm.ok).toBe(false);
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("DRAFT");
    const claim = await f.journal.claim(f.digest, "after-failure", 60000);
    expect(claim).not.toBeNull(); if (claim !== null) await f.journal.release(claim);
  } finally { await f.close(); }
});
