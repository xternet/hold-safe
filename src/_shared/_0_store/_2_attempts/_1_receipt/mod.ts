import { copyValue, type AttemptState, type Claim, type PolicyState, type Receipt } from "../../../../_kernel/mod";
import { context, event, guard, json, JournalError, uuid, type AttemptRow, type Db, type Tx } from "../../_shared/mod";

async function locked(sql: Tx, claim: Claim, id: string): Promise<AttemptRow> {
  uuid(id); await guard(sql, claim);
  const [row] = await sql<AttemptRow[]>`select * from solstock_guard.attempts where id=${id} and policy_id=${claim.policyDigest} for update`;
  if (row === undefined) throw new JournalError("Attempt not found for claimed policy");
  if (!["PREPARED", "SUBMITTED", "UNKNOWN"].includes(row.state)) throw new JournalError("Terminal attempt cannot change");
  return row;
}
export async function submitted(sql: Db, input: Claim, id: string): Promise<void> {
  const claim = copyValue(input);
  await sql.begin(async tx => {
    await locked(tx, claim, id);
    await tx`update solstock_guard.attempts set state='SUBMITTED',updated_at=clock_timestamp() where id=${id}`;
    await tx`update solstock_guard.policies set state='SUBMITTED',updated_at=clock_timestamp() where id=${claim.policyDigest}`;
    await event(tx, claim.policyDigest, "ATTEMPT_SUBMITTED", { id, fence: claim.fence });
  });
}
const states: Record<Receipt["state"], [AttemptState, PolicyState]> = {
  pending: ["SUBMITTED", "SUBMITTED"], unknown: ["UNKNOWN", "UNAVAILABLE"],
  confirmed: ["CONFIRMED", "CONFIRMED"], failed: ["FAILED", "FAILED"], expired: ["EXPIRED", "FAILED"],
};
export async function receipt(sql: Db, input: Claim, id: string, inputReceipt: Receipt): Promise<void> {
  const claim = copyValue(input), receipt = copyValue(inputReceipt); context(receipt.context);
  if (!Number.isSafeInteger(receipt.checkedAtMs) || receipt.checkedAtMs <= 0 || !Object.hasOwn(states, receipt.state)) throw new JournalError("Invalid receipt evidence");
  await sql.begin(async tx => {
    const row = await locked(tx, claim, id);
    if (row.native_id !== receipt.nativeId) throw new JournalError("Receipt signature differs from recorded attempt");
    if (row.receipt !== null && row.receipt.checkedAtMs > receipt.checkedAtMs) throw new JournalError("Receipt observation regressed");
    const [attemptState, policyState] = receipt.state === "pending"
      ? [row.state, row.state === "PREPARED" ? "TRIGGERED" : row.state === "UNKNOWN" ? "UNAVAILABLE" : "SUBMITTED"]
      : states[receipt.state];
    await tx`update solstock_guard.attempts set state=${attemptState},receipt=${json(receipt)}::jsonb,updated_at=clock_timestamp() where id=${id}`;
    await tx`update solstock_guard.policies set state=${policyState},updated_at=clock_timestamp() where id=${claim.policyDigest}`;
    await event(tx, claim.policyDigest, "ATTEMPT_RECEIPT", { id, receipt, fence: claim.fence });
  });
}
