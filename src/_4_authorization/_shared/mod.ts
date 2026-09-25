import { chainKey, copyValue, validatePolicy, type AuthorizationPort, type Catalog, type ChainRef,
  type Fault, type JournalPort, type Outcome, type Policy } from "../../_kernel/mod";

export type WorkflowOptions = { catalog: Catalog; chain: ChainRef; guard: string; keeper: string;
  journal: JournalPort; authorization: AuthorizationPort; now(): number; log(fault: Fault): void };
export class WorkflowError extends Error {}
export function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new WorkflowError(result.error.message);
  return result.value;
}
export function validate(options: WorkflowOptions, owner: string, document: Policy): Policy {
  const policy = copyValue(document);
  if (typeof owner !== "string" || owner.length === 0 || policy.owner !== owner) throw new WorkflowError("Owner identity does not match policy");
  if (policy.keeper !== options.keeper || policy.guard !== options.guard || chainKey(policy.chain) !== chainKey(options.chain)) {
    throw new WorkflowError("Policy targets unsupported operator or deployment");
  }
  validatePolicy(policy, options.catalog, Math.floor(options.now() / 1000));
  return policy;
}
export async function owned(options: WorkflowOptions, owner: string, digest: string) {
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) throw new WorkflowError("Policy unavailable to this owner");
  const record = await options.journal.readPolicy(digest);
  if (record === null || record.document.owner !== owner) throw new WorkflowError("Policy unavailable to this owner");
  return record;
}
