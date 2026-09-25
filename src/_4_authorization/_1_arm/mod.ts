import type { UnsignedTransaction } from "../../_kernel/mod";
import { owned, validate, value, WorkflowError, type WorkflowOptions } from "../_shared/mod";

export async function arm(options: WorkflowOptions, owner: string, digest: string,
  choice: { replaceExistingApproval: boolean }): Promise<UnsignedTransaction> {
  if (typeof choice?.replaceExistingApproval !== "boolean") throw new WorkflowError("Explicit delegate replacement choice required");
  await owned(options, owner, digest);
  const claim = await options.journal.claim(digest, `authorization-${crypto.randomUUID()}`, 60000);
  if (claim === null) throw new WorkflowError("Policy is busy; retry after the current operation");
  try {
    const record = await owned(options, owner, digest);
    if (!["DRAFT", "ARMING", "UNAVAILABLE"].includes(record.state)) throw new WorkflowError("Policy cannot be armed in its current state");
    const policy = validate(options, owner, record.document);
    const transaction = value(await options.authorization.prepareArm(policy, digest, choice));
    // A failed/expired claim or failed admission never returns an envelope to sign.
    await options.journal.renew(claim, 60000);
    if (record.state !== "ARMING") {
      await options.journal.transition(claim, record.state, "ARMING", { adapter: "policy-workflow", version: 1,
        serialized: JSON.stringify({ reason: "OWNER_SIGNATURE_REQUIRED", replaceExistingApproval: choice.replaceExistingApproval }) });
    }
    return transaction;
  } finally { await options.journal.release(claim); }
}
