import type { ChainRef, Policy } from "../../_0_types/mod";
import type { NativeContext } from "../_0_market/mod";
import type { Receipt, SignedAttempt } from "../_1_execution/mod";
import type { RiskDecision } from "../_2_risk/mod";

export type PolicyState = "DRAFT" | "ARMING" | "ARMED" | "TRIGGERED" | "SUBMITTED" | "CONFIRMED" | "REVOKED" | "EXPIRED" | "UNAVAILABLE" | "FAILED";
export type AttemptState = "PREPARED" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "UNKNOWN" | "EXPIRED";
export type PolicyRecord = { digest: string; document: Policy; state: PolicyState };
export type Claim = { policyDigest: string; workerId: string; fence: string; leaseUntilMs: number };
export type AttemptRecord = {
  id: string; policyDigest: string; signed: SignedAttempt; state: AttemptState;
  previousId: string | null; decisionId: string; receipt: Receipt | null;
};
export type Preparation = {
  id: string; decisionId: string; decision: RiskDecision; signed: SignedAttempt;
  previousId: string | null; execution: NativeContext;
};
// Rejections are logged by the implementation and propagated; an unavailable
// database never permits a caller to continue toward broadcast.
export interface JournalPort {
  putPolicy(policy: Policy): Promise<PolicyRecord>;
  readPolicy(digest: string): Promise<PolicyRecord | null>;
  scanOwner(chain: ChainRef, owner: string, afterDigest: string | null, limit: number): Promise<PolicyRecord[]>;
  scanActive(afterDigest: string | null, limit: number): Promise<PolicyRecord[]>;
  claim(digest: string, workerId: string, leaseMs: number): Promise<Claim | null>;
  renew(claim: Claim, leaseMs: number): Promise<Claim>;
  release(claim: Claim): Promise<void>;
  transition(claim: Claim, expected: PolicyState, next: PolicyState, evidence: NativeContext): Promise<void>;
  recordDecision(claim: Claim, id: string, decision: RiskDecision): Promise<void>;
  prepare(claim: Claim, preparation: Preparation): Promise<AttemptRecord>;
  latest(digest: string): Promise<AttemptRecord | null>;
  submitted(claim: Claim, id: string): Promise<void>;
  receipt(claim: Claim, id: string, receipt: Receipt): Promise<void>;
}
