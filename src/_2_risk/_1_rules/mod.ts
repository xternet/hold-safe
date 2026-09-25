import { copyValue } from "../../_kernel/mod";
import { compare, ratio, type Outcome, type RiskDecision, type RiskEvaluation, type RiskInput, type RiskState } from "../../_kernel/mod";
import type { BoundRisk, ReadyEvidence } from "../_shared/mod";

export function decide(bound: BoundRisk, input: RiskInput, previous: RiskState | null, ready: Outcome<ReadyEvidence>): RiskEvaluation {
  const { nowMs: now, gapEpoch } = input, { policy, digest } = bound;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(gapEpoch) || gapEpoch < 0) throw new Error("Invalid risk clock/gap epoch");
  const state: RiskState = { policyDigest: digest, startedAtMs: null, lastEvaluatedAtMs: now, gapEpoch, sourceTimes: [], multiplier: null };
  const unavailable = (reason: string): RiskEvaluation => ({ state, decision: { policyDigest: digest, rule: "divergence@1", evaluatedAtMs: now,
    state: "UNAVAILABLE", reason, evidence: { observationIds: [], sourceTimes: [], quoteId: null, elapsedMs: 0 } } });
  if (previous !== null && (previous.policyDigest !== digest || now < previous.lastEvaluatedAtMs || gapEpoch < previous.gapEpoch)) return unavailable("STATE_DOMAIN_OR_TIME_REGRESSION");
  if (!ready.ok) {
    const result = unavailable(ready.error.message); result.decision.evidence.unavailable = copyValue(ready.error); return result;
  }
  const { evidence, multiplier } = ready.value;
  if (previous !== null && previous.sourceTimes.length > 0 && evidence.sourceTimes.some((time, index) => previous.sourceTimes[index] === undefined || time < previous.sourceTimes[index]!)) {
    return unavailable("SOURCE_TIME_REGRESSION");
  }
  state.sourceTimes = [...evidence.sourceTimes]; state.multiplier = multiplier;
  let status: RiskDecision["state"] = "CLEAR", reason = "BELOW_THRESHOLD";
  if (compare(evidence.discountBps, ratio(BigInt(policy.rule.thresholdBps), 1n)) >= 0) {
    const continuous = previous !== null && previous.startedAtMs !== null && previous.multiplier !== null &&
      previous.gapEpoch === gapEpoch && now - previous.lastEvaluatedAtMs < policy.rule.maxAgeMs && compare(multiplier, previous.multiplier) === 0;
    state.startedAtMs = continuous ? previous.startedAtMs : now;
    if (state.startedAtMs === null || !Number.isSafeInteger(state.startedAtMs) || state.startedAtMs > now) return unavailable("INVALID_PERSISTENCE_STATE");
    evidence.elapsedMs = Math.max(0, Math.min(...evidence.sourceTimes) - state.startedAtMs);
    status = evidence.elapsedMs >= policy.rule.persistenceMs ? "TRIGGERED" : "PENDING";
    reason = status === "TRIGGERED" ? "SUSTAINED_EXECUTABLE_DIVERGENCE" : "AWAITING_PERSISTENCE";
  }
  return { state, decision: { policyDigest: digest, rule: "divergence@1", evaluatedAtMs: now, state: status, reason, evidence } };
}
