import type { Fault, Policy, Rational, RiskEvidence } from "../../_kernel/mod";

export type BoundRisk = { policy: Policy; digest: string; inputDecimals: number; outputDecimals: number };
export type ReadyEvidence = {
  evidence: RiskEvidence & { shares: Rational; referenceUsd: Rational; exitUsd: Rational; discountBps: Rational; quoteId: string };
  multiplier: Rational;
};
export class Ineligible extends Error {
  readonly fault: Fault;
  constructor(reason: string, context: Record<string, string> = {}) {
    super(reason); this.fault = { code: "UNAVAILABLE", message: reason, retryable: true, context };
  }
}
