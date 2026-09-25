import { chainKey, copyValue, type Claim, type Preparation } from "../../../../_kernel/mod";
import { attemptRecord, context, event, guard, json, JournalError, latest, uuid, type AttemptRow, type Db } from "../../_shared/mod";

export async function prepare(sql: Db, inputClaim: Claim, input: Preparation) {
  const claim = copyValue(inputClaim), plan = copyValue(input), signed = plan.signed;
  uuid(plan.id); uuid(plan.decisionId); if (plan.previousId !== null) uuid(plan.previousId);
  context(signed.validity); context(plan.execution);
  const bytes = Buffer.from(signed.bytesBase64, "base64");
  if (bytes.length === 0 || bytes.length > 65536 || bytes.toString("base64") !== signed.bytesBase64 || !signed.nativeId ||
    signed.nativeId.length > 256) throw new JournalError("Invalid signed attempt encoding");
  if (signed.policyDigest !== claim.policyDigest || plan.decision.policyDigest !== claim.policyDigest ||
    plan.decision.state !== "TRIGGERED" || plan.decision.rule !== "divergence@1" ||
    !Number.isSafeInteger(plan.decision.evaluatedAtMs) || plan.decision.evaluatedAtMs <= 0 || !plan.decision.reason) throw new JournalError("Attempt decision does not authorize this policy");
  return sql.begin(async tx => {
    await tx`set local synchronous_commit=on`;
    const policy = await guard(tx, claim);
    if (policy.state !== "ARMED" || chainKey(policy.document.chain) !== chainKey(signed.chain)) throw new JournalError("Policy not armed or attempt domain differs");
    const previous = await latest(tx, claim.policyDigest);
    if (previous === null ? plan.previousId !== null : plan.previousId !== previous.id || !["FAILED", "EXPIRED"].includes(previous.state)) throw new JournalError("Attempt unresolved or retry lineage differs");
    await tx`insert into solstock_guard.decisions(id,policy_id,rule_version,reason,evidence)
      values(${plan.decisionId},${claim.policyDigest},${plan.decision.rule},${plan.decision.reason},
        ${json({ decision: plan.decision, execution: plan.execution })}::jsonb)`;
    const [row] = await tx<AttemptRow[]>`insert into solstock_guard.attempts
      (id,policy_id,chain_namespace,network,native_id,transaction_bytes,validity,state,previous_attempt,decision_id)
      values(${plan.id},${claim.policyDigest},${signed.chain.namespace},${signed.chain.reference},${signed.nativeId},${bytes},
        ${json(signed.validity)}::jsonb,'PREPARED',${plan.previousId},${plan.decisionId}) returning *`;
    if (row === undefined) throw new JournalError("Attempt insertion returned no record");
    await tx`update solstock_guard.policies set state='TRIGGERED',updated_at=clock_timestamp() where id=${claim.policyDigest}`;
    await event(tx, claim.policyDigest, "ATTEMPT_PREPARED", { id: plan.id, decisionId: plan.decisionId, nativeId: signed.nativeId, fence: claim.fence });
    return attemptRecord(row);
  });
}
