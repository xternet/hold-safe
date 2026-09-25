import type { Outcome, Policy } from "../../_0_types/mod";
import type { AuthorizationState, Receipt, UnsignedTransaction } from "../_1_execution/mod";
import type { AttemptState, PolicyRecord } from "../_3_journal/mod";

export type PolicyPreview = { digest: string; policy: Policy; networkFeesRaw: string; allocationRaw: string; limitations: string[] };
export type PolicyView = {
  record: PolicyRecord;
  authorization: Outcome<AuthorizationState>;
  attempt: { state: AttemptState; nativeId: string; receipt: Receipt | null } | null;
};
// Owner is supplied by the authenticated API boundary, never from request policy alone.
export interface PolicyWorkflowPort {
  list(owner: string, after: string | null, limit: number): Promise<Outcome<PolicyRecord[]>>;
  preview(owner: string, policy: Policy): Promise<Outcome<PolicyPreview>>;
  arm(owner: string, digest: string, options: { replaceExistingApproval: boolean }): Promise<Outcome<UnsignedTransaction>>;
  revoke(owner: string, digest: string): Promise<Outcome<UnsignedTransaction>>;
  status(owner: string, digest: string): Promise<Outcome<PolicyView>>;
}
