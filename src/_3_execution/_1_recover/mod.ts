import type { AttemptRecord } from "../../_kernel/mod";
import { check, value, type Session, type WorkerOptions } from "../_shared/mod";
import { send } from "../_0_prepare/mod";

export async function recover(options: WorkerOptions, session: Session, attempt: AttemptRecord, signal: AbortSignal): Promise<boolean> {
  session.state = null; session.lastDecision = null;
  check(signal);
  const receipt = value(await options.execution.reconcile(attempt.signed)); check(signal);
  await options.journal.receipt(session.claim, attempt.id, receipt);
  if (receipt.state === "confirmed") { session.record.state = "CONFIRMED"; return true; }
  if (receipt.state === "failed" || receipt.state === "expired") { session.record.state = "FAILED"; return false; }
  if (receipt.state === "pending" && attempt.state === "PREPARED") await send(options, session, attempt, signal);
  return false;
}
