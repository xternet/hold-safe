import { copyValue } from "../../_kernel/mod";
import { assetKey, chainKey, compare, divergenceBps, multiply, parseRaw, ratio, units,
  type Outcome, type PriceObservation, type Rational, type ReferenceMapping, type RiskInput } from "../../_kernel/mod";
import { Ineligible, type BoundRisk, type ReadyEvidence } from "../_shared/mod";

function eligible(condition: boolean, reason: string, context: Record<string, string> = {}): void {
  if (!condition) throw new Ineligible(reason, context);
}
function rational(value: Rational, positive = true, context: Record<string, string> = {}): void {
  eligible(typeof value?.n === "bigint" && typeof value?.d === "bigint" && value.d > 0n && (!positive || value.n > 0n), "INVALID_RATIONAL", context);
}
function timestamp(source: number, received: number, now: number, age: number, label: string): void {
  eligible([source, received].every(Number.isSafeInteger) && source >= 0 && source <= received && received <= now && now - source < age,
    "STALE_FUTURE_OR_INVALID_TIME", { source: label, sourceAtMs: String(source), receivedAtMs: String(received), evaluatedAtMs: String(now) });
}
function price(value: PriceObservation, expected: ReferenceMapping, session: PriceObservation["session"]): void {
  const context = { provider: expected.provider, instrument: expected.instrument, sourceAtMs: String(value.sourceAtMs), receivedAtMs: String(value.receivedAtMs) };
  eligible(value.provider === expected.provider && value.instrument === expected.instrument && value.coverage === expected.coverage, "REFERENCE_IDENTITY_MISMATCH", context);
  eligible(typeof value.id === "string" && value.id.length > 0 && value.session === session, "REFERENCE_SESSION_OR_ID", context);
  for (const item of [value.bidUsd, value.askUsd, value.bidSize, value.askSize]) rational(item, true, context);
  eligible(compare(value.bidUsd, value.askUsd) <= 0, "CROSSED_REFERENCE", context);
}
export function validateEvidence(bound: BoundRisk, input: RiskInput): Outcome<ReadyEvidence> {
  try {
    const { policy, digest } = bound, { nowMs: now } = input;
    eligible(policy.expiresAt * 1000 > now, "POLICY_EXPIRED");
    eligible(input.session === "regular", "STOCK_SESSION_UNAVAILABLE");
    for (const key of ["reference", "output", "holding", "quote", "authorization"] as const) {
      const result = input[key];
      if (!result.ok) return { ok: false, error: { ...result.error, message: `${key.toUpperCase()}_UNAVAILABLE`, context: { ...result.error.context, cause: result.error.message } } };
    }
    if (!input.reference.ok || !input.output.ok || !input.holding.ok || !input.quote.ok || !input.authorization.ok) throw new Error("Evidence narrowing failed");
    const r = input.reference.value, o = input.output.value, h = input.holding.value, q = input.quote.value, a = input.authorization.value;
    price(r, policy.coverage.inputReference, "regular"); price(o, policy.coverage.outputReference, "continuous");
    eligible(r.sizeUnit === "round_lots" && o.sizeUnit === "base_asset", "REFERENCE_UNIT_MISMATCH");
    const times = [r.sourceAtMs, o.sourceAtMs, h.sourceAtMs, q.sourceAtMs, a.sourceAtMs];
    timestamp(r.sourceAtMs, r.receivedAtMs, now, policy.rule.maxAgeMs, r.provider);
    timestamp(o.sourceAtMs, o.receivedAtMs, now, policy.rule.maxAgeMs, o.provider);
    timestamp(h.sourceAtMs, h.receivedAtMs, now, policy.rule.maxAgeMs, "holding");
    timestamp(q.sourceAtMs, q.quotedAtMs, now, policy.rule.maxAgeMs, "quote");
    timestamp(a.sourceAtMs, a.receivedAtMs, now, policy.rule.maxAgeMs, "authorization");
    eligible(Math.max(...times) - Math.min(...times) <= policy.rule.maxSkewMs, "SOURCE_SKEW");
    eligible(a.state === "active" && a.policyDigest === digest && typeof a.delegate === "string" && a.delegate.length > 0 && a.delegate !== policy.keeper, "AUTHORIZATION_UNAVAILABLE");
    eligible(assetKey(h.asset) === assetKey(policy.input) && h.account === policy.source && h.owner === policy.owner && typeof h.id === "string" && h.id.length > 0, "HOLDING_IDENTITY_MISMATCH");
    eligible(h.frozen === false && h.paused === false && h.delegate === a.delegate, "HOLDING_RESTRICTED_OR_REVOKED");
    const amount = parseRaw(policy.amountRaw);
    eligible(parseRaw(h.balanceRaw, true) >= amount, "INSUFFICIENT_BALANCE");
    eligible(parseRaw(h.allowanceRaw, true) >= amount && parseRaw(a.remainingRaw, true) >= amount, "INSUFFICIENT_ALLOWANCE");
    rational(h.multiplier);
    eligible(typeof q.id === "string" && q.id.length > 0 && q.policyDigest === digest && chainKey(q.chain) === chainKey(policy.chain) && q.routeId === policy.routeId &&
      assetKey(q.input.asset) === assetKey(policy.input) && q.input.raw === policy.amountRaw && assetKey(q.output.asset) === assetKey(policy.output), "QUOTE_IDENTITY_MISMATCH");
    eligible(Number.isSafeInteger(q.expiresAtMs) && q.expiresAtMs > now && q.expiresAtMs > q.quotedAtMs, "QUOTE_EXPIRED");
    const output = parseRaw(q.output.raw), minimum = parseRaw(q.minimumOutputRaw);
    eligible(minimum >= parseRaw(policy.minimumOutputRaw) && minimum >= output * BigInt(10000 - policy.slippageBps) / 10000n && minimum <= output, "QUOTE_FLOOR_VIOLATION");
    rational(q.priceImpactBps, false);
    eligible(compare(q.priceImpactBps, ratio(BigInt(policy.rule.maxImpactBps), 1n)) <= 0, "EXCESSIVE_PRICE_IMPACT");
    const deviation = BigInt(policy.rule.maxOutputDeviationBps);
    eligible(compare(o.bidUsd, ratio(10000n - deviation, 10000n)) >= 0 && compare(o.askUsd, ratio(10000n + deviation, 10000n)) <= 0, "OUTPUT_DOLLAR_DEVIATION");
    const outputUnits = units(output, bound.outputDecimals);
    eligible(compare(o.bidSize, outputUnits) >= 0, "OUTPUT_REFERENCE_DEPTH");
    const shares = multiply(units(amount, bound.inputDecimals), h.multiplier);
    const referenceUsd = multiply(shares, r.bidUsd), exitUsd = multiply(outputUnits, o.bidUsd);
    return { ok: true, value: { multiplier: ratio(h.multiplier.n, h.multiplier.d), evidence: {
      observationIds: [r.id, o.id, h.id], sourceTimes: times, quoteId: q.id,
      authorization: copyValue(a),
      shares, referenceUsd, exitUsd, discountBps: divergenceBps(referenceUsd, exitUsd), elapsedMs: 0 } } };
  } catch (error) {
    return { ok: false, error: error instanceof Ineligible ? error.fault : {
      code: "INVALID", message: "MALFORMED_EVIDENCE", retryable: false,
      context: { evaluatedAtMs: String(input.nowMs), cause: error instanceof Error ? error.message : "Non-error validation failure" } } };
  }
}
