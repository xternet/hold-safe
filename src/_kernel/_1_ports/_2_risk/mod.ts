import type { Fault, Outcome } from "../../_0_types/mod";
import type { Rational } from "../../_4_units/mod";
import type { ExitQuote, HoldingObservation, PriceObservation } from "../_0_market/mod";
import type { AuthorizationState } from "../_1_execution/mod";

export type RiskInput = {
  nowMs: number; gapEpoch: number; session: PriceObservation["session"];
  reference: Outcome<PriceObservation>; output: Outcome<PriceObservation>;
  holding: Outcome<HoldingObservation>; quote: Outcome<ExitQuote>; authorization: Outcome<AuthorizationState>;
};
export type RiskState = {
  policyDigest: string; startedAtMs: number | null; lastEvaluatedAtMs: number;
  gapEpoch: number; sourceTimes: readonly number[]; multiplier: Rational | null;
};
export type RiskEvidence = {
  observationIds: readonly string[]; sourceTimes: readonly number[]; quoteId: string | null;
  shares?: Rational; referenceUsd?: Rational; exitUsd?: Rational; discountBps?: Rational;
  elapsedMs: number;
  unavailable?: Fault;
  authorization?: AuthorizationState;
};
export type RiskDecision = {
  policyDigest: string; rule: "divergence@1"; evaluatedAtMs: number;
  state: "UNAVAILABLE" | "CLEAR" | "PENDING" | "TRIGGERED"; reason: string; evidence: RiskEvidence;
};
export type RiskEvaluation = { state: RiskState; decision: RiskDecision };
export interface RiskRule {
  readonly id: "divergence"; readonly version: 1; readonly policyDigest: string;
  readonly requiredInputs: readonly ["reference", "output", "holding", "quote", "authorization", "session"];
  evaluate(input: RiskInput, previous: RiskState | null): RiskEvaluation;
}
