import { copyValue, type Claim, type RiskDecision } from "../../../../_kernel/mod";
import { guard, json, JournalError, uuid, type Db } from "../../_shared/mod";

export async function recordDecision(sql: Db, inputClaim: Claim, id: string, input: RiskDecision): Promise<void> {
  const claim = copyValue(inputClaim), decision = copyValue(input); uuid(id);
  if (decision.policyDigest !== claim.policyDigest || decision.rule !== "divergence@1" ||
    !["CLEAR", "PENDING", "UNAVAILABLE"].includes(decision.state) || !Number.isSafeInteger(decision.evaluatedAtMs) ||
    decision.evaluatedAtMs <= 0 || !decision.reason) throw new JournalError("Invalid monitoring decision");
  await sql.begin(async tx => {
    await guard(tx, claim);
    await tx`insert into solstock_guard.decisions(id,policy_id,rule_version,reason,evidence)
      values(${id},${claim.policyDigest},${decision.rule},${decision.reason},${json({ decision })}::jsonb)`;
  });
}
