import { expect, test } from "bun:test";
import { createRiskRule } from "./mod";
import { ratio, type RiskInput } from "../_kernel/mod";
import { riskFixture } from "./_test/mod";

test("hand-computed scaled-share divergence persists only through fresh source evidence", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  const first = rule.evaluate(f.input(), null);
  expect(first.decision.state).toBe("PENDING");
  expect(first.decision.evidence.shares).toEqual(ratio(3n, 2n));
  expect(first.decision.evidence.referenceUsd).toEqual(ratio(300n, 1n));
  expect(first.decision.evidence.exitUsd).toEqual(ratio(290n, 1n));
  expect(first.decision.evidence.discountBps).toEqual(ratio(1000n, 3n));
  let state = first.state;
  for (const elapsed of [1000, 2000, 2999]) {
    const result = rule.evaluate(f.input(f.start + elapsed), state);
    expect(result.decision.state).toBe("PENDING"); state = result.state;
  }
  const fired = rule.evaluate(f.input(f.start + 3000), state);
  expect(fired.decision.state).toBe("TRIGGERED"); expect(fired.decision.evidence.elapsedMs).toBe(3000);
  expect(fired.decision.policyDigest).toBe(f.digest); expect(fired.decision.evidence.observationIds.length).toBe(3);
  const unchanged = f.input(); unchanged.nowMs += 1000;
  expect(rule.evaluate(unchanged, first.state).decision.evidence.elapsedMs).toBe(0);
});
test("gaps, failed inputs, backward time and multiplier changes reset accumulated persistence", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  const initial = rule.evaluate(f.input(), null).state;
  for (const edit of [
    (x: RiskInput) => { x.gapEpoch++; },
    (x: RiskInput) => { if (x.holding.ok) x.holding.value.multiplier = ratio(2n, 1n); },
  ]) {
    const input = f.input(f.start + 3000); edit(input);
    const result = rule.evaluate(input, initial);
    expect(result.decision.state).toBe("PENDING"); expect(result.decision.evidence.elapsedMs).toBe(0);
  }
  const failed = f.input(f.start + 1000);
  failed.reference = { ok: false, error: { code: "UNAVAILABLE", message: "Disconnected", retryable: true, context: {} } };
  const gap = rule.evaluate(failed, initial);
  expect(gap.decision.state).toBe("UNAVAILABLE"); expect(gap.state.startedAtMs).toBeNull();
  expect(rule.evaluate(f.input(f.start + 3000), gap.state).decision.state).toBe("PENDING");
  expect(rule.evaluate(f.input(f.start - 1), initial).decision.state).toBe("UNAVAILABLE");
  expect(rule.evaluate(f.input(f.start + 6000), initial).decision.evidence.elapsedMs).toBe(0);
});
test("identity, authorization, liquidity, session and freshness failures cannot trigger", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  const state = rule.evaluate(f.input(), null).state;
  const edits: ((x: RiskInput) => void)[] = [
    x => { x.session = "closed"; }, x => { x.session = "unknown"; },
    x => { if (x.reference.ok) x.reference.value.provider = "different-feed"; },
    x => { if (x.reference.ok) x.reference.value.sourceAtMs += 1; },
    x => { if (x.reference.ok) x.reference.value.sourceAtMs -= 5000; },
    x => { if (x.reference.ok) x.reference.value.sourceAtMs -= 2001; },
    x => { if (x.reference.ok) x.reference.value.bidUsd = ratio(0n, 1n); },
    x => { if (x.output.ok) x.output.value.bidUsd = ratio(98n, 100n); },
    x => { if (x.output.ok) x.output.value.askUsd = ratio(102n, 100n); },
    x => { if (x.output.ok) x.output.value.bidSize = ratio(1n, 1n); },
    x => { if (x.holding.ok) x.holding.value.delegate = f.policy.keeper; },
    x => { if (x.holding.ok) x.holding.value.balanceRaw = "1"; },
    x => { if (x.holding.ok) x.holding.value.allowanceRaw = "1"; },
    x => { if (x.holding.ok) x.holding.value.frozen = true; },
    x => { if (x.holding.ok) x.holding.value.paused = true; },
    x => { if (x.holding.ok) x.holding.value.paused = undefined as unknown as boolean; },
    x => { if (x.quote.ok) x.quote.value.expiresAtMs = x.nowMs; },
    x => { if (x.quote.ok) x.quote.value.policyDigest = "00".repeat(32); },
    x => { if (x.quote.ok) x.quote.value.input.raw = "1"; },
    x => { if (x.quote.ok) x.quote.value.minimumOutputRaw = "1"; },
    x => { if (x.quote.ok) x.quote.value.priceImpactBps = ratio(101n, 1n); },
    x => { if (x.authorization.ok) x.authorization.value.state = "revoked"; },
    x => { if (x.authorization.ok) x.authorization.value.policyDigest = "00".repeat(32); },
    x => { if (x.quote.ok) x.quote.value.output.asset.chain.reference = "other-network"; },
    x => { if (x.holding.ok) x.holding.value.asset.chain.reference = "other-network"; },
    x => { if (x.authorization.ok) x.authorization.value.remainingRaw = "0"; },
  ];
  for (const edit of edits) {
    const input = f.input(f.start + 3000); edit(input);
    const result = rule.evaluate(input, state);
    expect(result.decision.state).toBe("UNAVAILABLE"); expect(result.state.startedAtMs).toBeNull();
  }
});

test("large raw amounts remain exact beyond JavaScript safe integers", async () => {
  const f = await riskFixture(), raw = 9007199254740993n;
  f.policy.amountRaw = raw.toString(); f.policy.minimumOutputRaw = "1";
  const rule = await createRiskRule(f.policy, f.catalog, f.start), input = f.input();
  if (!input.quote.ok || !input.holding.ok || !input.authorization.ok || !input.output.ok) throw new Error("Missing test evidence");
  input.quote.value.policyDigest = rule.policyDigest; input.authorization.value.policyDigest = rule.policyDigest;
  input.quote.value.output.raw = (raw * 29n / 10n).toString();
  input.quote.value.minimumOutputRaw = (BigInt(input.quote.value.output.raw) * 9900n / 10000n).toString();
  input.output.value.bidSize = ratio(raw, 1n);
  const result = rule.evaluate(input, null);
  expect(result.decision.state).toBe("PENDING");
  expect(result.decision.evidence.shares).toEqual(ratio(27021597764222979n, 200000000n));
  expect(result.decision.evidence.referenceUsd).toEqual(ratio(27021597764222979n, 1000000n));
});
test("enumerated output amounts match an independent integer threshold inequality", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  for (let dollars = 281n; dollars <= 310n; dollars++) for (const remainder of [-1n, 0n, 1n]) {
    const raw = dollars * 1000000n + remainder, input = f.input();
    if (!input.quote.ok) throw new Error("Missing test quote");
    input.quote.value.output.raw = raw.toString();
    const minimum = raw * 9900n / 10000n;
    input.quote.value.minimumOutputRaw = (minimum < 280000000n ? 280000000n : minimum).toString();
    const shouldPersist = 10000n * (300000000n - raw) >= 300n * 300000000n;
    expect(rule.evaluate(input, null).decision.state).toBe(shouldPersist ? "PENDING" : "CLEAR");
  }
});
test("recovery below threshold, old evidence and a different policy state cannot preserve a trigger", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  const first = rule.evaluate(f.input(), null).state;
  const clear = f.input(f.start + 1000);
  if (!clear.quote.ok) throw new Error("Missing quote");
  clear.quote.value.output.raw = "300000000"; clear.quote.value.minimumOutputRaw = "297000000";
  const cleared = rule.evaluate(clear, first); expect(cleared.decision.state).toBe("CLEAR");
  const resumed = rule.evaluate(f.input(f.start + 2000), cleared.state);
  expect(rule.evaluate(f.input(f.start + 4000), resumed.state).decision.state).toBe("PENDING");
  expect(rule.evaluate(f.input(f.start + 3000), { ...first, policyDigest: "other" }).decision.state).toBe("UNAVAILABLE");
  const replay = f.input(f.start + 1000); replay.nowMs = f.start + 2400;
  const newer = rule.evaluate(f.input(f.start + 2000), first);
  expect(rule.evaluate(replay, newer.state).decision.reason).toBe("SOURCE_TIME_REGRESSION");
});
test("threshold boundary is exact and healthy dollar price is applied rather than assumed", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  for (const raw of ["291000001", "291000000", "290999999"]) {
    const input = f.input(); if (!input.quote.ok) throw new Error("Fixture quote missing");
    input.quote.value.output.raw = raw; input.quote.value.minimumOutputRaw = (BigInt(raw) * 9900n / 10000n).toString();
    expect(rule.evaluate(input, null).decision.state).toBe(raw === "291000001" ? "CLEAR" : "PENDING");
  }
  const input = f.input(); if (!input.output.ok) throw new Error("Fixture output missing");
  input.output.value.bidUsd = ratio(999n, 1000n);
  expect(rule.evaluate(input, null).decision.evidence.exitUsd).toEqual(ratio(28971n, 100n));
  f.policy.rule.thresholdBps = 10000;
  expect(rule.evaluate(f.input(), null).decision.state).toBe("PENDING"); // Bound rule owns its copy.
});
