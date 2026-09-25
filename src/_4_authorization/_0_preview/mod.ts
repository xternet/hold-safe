import type { Policy, PolicyPreview } from "../../_kernel/mod";
import { validate, value, type WorkflowOptions } from "../_shared/mod";

export async function preview(options: WorkflowOptions, owner: string, document: Policy): Promise<PolicyPreview> {
  const policy = validate(options, owner, document);
  const costs = value(await options.authorization.preview(policy));
  const record = await options.journal.putPolicy(policy);
  return { digest: record.digest, policy: record.document, ...costs };
}
