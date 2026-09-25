import { copyValue, validateCatalog, type Outcome, type PolicyWorkflowPort } from "../_kernel/mod";
import { preview } from "./_0_preview/mod";
import { arm } from "./_1_arm/mod";
import { revoke, status } from "./_2_read/mod";
import { WorkflowError, type WorkflowOptions } from "./_shared/mod";

export function createPolicyWorkflow(input: WorkflowOptions): PolicyWorkflowPort {
  const options = { ...input, catalog: validateCatalog(copyValue(input.catalog)), chain: copyValue(input.chain) };
  async function run<T>(action: string, work: () => Promise<T>): Promise<Outcome<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      const fault = { code: "UNAVAILABLE" as const, retryable: true,
        message: error instanceof WorkflowError ? error.message : "Policy operation failed; details redacted",
        context: { component: "policy-workflow", action } };
      options.log(fault); return { ok: false, error: fault };
    }
  }
  return {
    list: (owner, after, limit) => run("list", () => options.journal.scanOwner(options.chain, owner, after, limit)),
    preview: (owner, policy) => run("preview", () => preview(options, owner, policy)),
    arm: (owner, digest, choice) => run("arm", () => arm(options, owner, digest, copyValue(choice))),
    revoke: (owner, digest) => run("revoke", () => revoke(options, owner, digest)),
    status: (owner, digest) => run("status", () => status(options, owner, digest)),
  };
}
