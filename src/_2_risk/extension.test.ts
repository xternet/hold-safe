import { expect, test } from "bun:test";
import { copyValue, ratio, validateCatalog } from "../_kernel/mod";
import { createRiskRule } from "./mod";
import { riskFixture } from "./_test/mod";

test("a second compatible catalog asset uses unchanged risk logic and remains separately bound", async () => {
  const f = await riskFixture(), original = copyValue(f.policy);
  const asset = copyValue(f.catalog.assets[0]!), route = copyValue(f.catalog.routes[0]!);
  asset.ref.address = "SecondStockMint"; asset.symbol = "SECOND"; asset.reference.instrument = "MSFT";
  route.id = "route-second"; route.input = copyValue(asset.ref); route.pool = "second-pool";
  f.catalog.feeds[0]!.instruments.push("MSFT"); f.catalog.assets.push(asset); f.catalog.routes.push(route);
  f.policy.input = copyValue(asset.ref); f.policy.routeId = route.id; f.policy.source = "second-source";
  f.policy.coverage.inputReference = copyValue(asset.reference); f.policy.coverage.pool = route.pool;
  const catalog = validateCatalog(f.catalog), rule = await createRiskRule(f.policy, catalog, f.start);
  expect(rule.policyDigest).not.toBe(f.digest); expect(original.input.address).toBe("StockMint");
  let state = null;
  for (const elapsed of [0, 1000, 2000, 3000]) {
    const input = f.input(f.start + elapsed);
    if (!input.quote.ok || !input.authorization.ok) throw new Error("Missing fixture inputs");
    input.quote.value.policyDigest = rule.policyDigest; input.authorization.value.policyDigest = rule.policyDigest;
    const result = rule.evaluate(input, state);
    expect(result.decision.state).toBe(elapsed === 3000 ? "TRIGGERED" : "PENDING"); state = result.state;
  }
  const wrong = f.input(f.start + 4000);
  if (!wrong.quote.ok) throw new Error("Missing quote");
  wrong.quote.value.input.asset = original.input;
  expect(rule.evaluate(wrong, state).decision.state).toBe("UNAVAILABLE");
});

test("consistent split and reinvestment multiplier changes preserve fair value without false divergence", async () => {
  const f = await riskFixture(), rule = await createRiskRule(f.policy, f.catalog, f.start);
  let state = null;
  // Controlled coherent examples, not evidence of live corporate-action timing.
  for (const [index, multiplier, bid] of [[0, ratio(3n, 2n), ratio(200n, 1n)],
    [1, ratio(3n, 1n), ratio(100n, 1n)], [2, ratio(303n, 100n), ratio(10000n, 101n)]] as const) {
    const input = f.input(f.start + index * 1000);
    if (!input.quote.ok || !input.reference.ok || !input.holding.ok) throw new Error("Missing fixture observations");
    input.holding.value.multiplier = multiplier; input.reference.value.bidUsd = bid; input.reference.value.askUsd = bid;
    input.quote.value.output.raw = "300000000"; input.quote.value.minimumOutputRaw = "297000000";
    const result = rule.evaluate(input, state);
    expect(result.decision.state).toBe("CLEAR"); expect(result.decision.evidence.referenceUsd).toEqual(ratio(300n, 1n));
    state = result.state;
  }
});
