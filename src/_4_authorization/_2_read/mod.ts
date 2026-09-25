import type { PolicyView } from "../../_kernel/mod";
import { owned, value, type WorkflowOptions } from "../_shared/mod";

export async function status(options: WorkflowOptions, owner: string, digest: string): Promise<PolicyView> {
  const record = await owned(options, owner, digest);
  const [authorization, latest] = await Promise.all([
    options.authorization.read(record.document), options.journal.latest(digest),
  ]);
  return { record, authorization, attempt: latest === null ? null : {
    state: latest.state, nativeId: latest.signed.nativeId, receipt: latest.receipt,
  } };
}
export async function revoke(options: WorkflowOptions, owner: string, digest: string) {
  const record = await owned(options, owner, digest);
  // Native cancellation must remain possible while execution owns the DB claim.
  return value(await options.authorization.prepareRevoke(record.document));
}
