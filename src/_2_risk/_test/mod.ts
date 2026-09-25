import { copyValue } from "../../_kernel/mod";
import { policyDigest, ratio, type RiskInput } from "../../_kernel/mod";
import { policyFixture, catalogFixture } from "../../_kernel/_test/mod";

export async function riskFixture() {
  const policy = policyFixture(), catalog = catalogFixture(), start = 1_000_000;
  policy.amountRaw = "100000000"; policy.minimumOutputRaw = "280000000";
  const digest = await policyDigest(policy);
  function input(nowMs = start): RiskInput {
    const context = { adapter: "unit", version: 1, serialized: "{}" };
    const value: RiskInput = { nowMs, gapEpoch: 0, session: "regular",
      reference: { ok: true, value: { id: `reference-${nowMs}`, ...policy.coverage.inputReference, bidUsd: ratio(200n, 1n), askUsd: ratio(201n, 1n),
        bidSize: ratio(10n, 1n), askSize: ratio(10n, 1n), sizeUnit: "round_lots", sourceAtMs: nowMs, receivedAtMs: nowMs, session: "regular" } },
      output: { ok: true, value: { id: `output-${nowMs}`, ...policy.coverage.outputReference, bidUsd: ratio(1n, 1n), askUsd: ratio(1n, 1n),
        bidSize: ratio(10000n, 1n), askSize: ratio(10000n, 1n), sizeUnit: "base_asset", sourceAtMs: nowMs, receivedAtMs: nowMs, session: "continuous" } },
      holding: { ok: true, value: { id: `holding-${nowMs}`, asset: policy.input, account: policy.source, owner: policy.owner, balanceRaw: policy.amountRaw,
        delegate: "policy-delegate", allowanceRaw: policy.amountRaw, frozen: false, paused: false, multiplier: ratio(3n, 2n), sourceAtMs: nowMs, receivedAtMs: nowMs, context } },
      quote: { ok: true, value: { id: `quote-${nowMs}`, policyDigest: digest, chain: policy.chain, routeId: policy.routeId,
        input: { asset: policy.input, raw: policy.amountRaw }, output: { asset: policy.output, raw: "290000000" }, minimumOutputRaw: "287100000",
        sourceAtMs: nowMs, quotedAtMs: nowMs, expiresAtMs: nowMs + 1500, priceImpactBps: ratio(50n, 1n), context } },
      authorization: { ok: true, value: { policyDigest: digest, state: "active", remainingRaw: policy.amountRaw, delegate: "policy-delegate",
        sourceAtMs: nowMs, receivedAtMs: nowMs, context } },
    };
    return copyValue(value);
  }
  return { policy, catalog, digest, start, input };
}
