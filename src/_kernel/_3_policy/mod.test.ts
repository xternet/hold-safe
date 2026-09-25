import { expect, test } from "bun:test";
import { canonicalPolicy, policyDigest, validatePolicy } from "./mod";
import { assetKey, chainKey } from "../_0_types/mod";
import { policyFixture, catalogFixture } from "../_test/mod";
import { validateCatalog } from "../_2_catalog/mod";

test("identities preserve native address case and network domains", () => {
  const p = policyFixture();
  expect(assetKey(p.input)).not.toBe(assetKey({ ...p.input, chain: { ...p.chain, reference: "other-network" } }));
  expect(assetKey(p.input)).not.toBe(assetKey({ ...p.input, address: p.input.address.toLowerCase() }));
  expect(() => chainKey({ namespace: undefined as unknown as string, reference: "network" })).toThrow();
  expect(() => chainKey({ namespace: "solana", reference: " network " })).toThrow();
});

test("canonical policy and hash ignore object insertion order", async () => {
  const p = policyFixture();
  const reordered = Object.fromEntries(Object.entries(p).reverse()) as typeof p;
  expect(canonicalPolicy(reordered)).toBe(canonicalPolicy(p));
  expect(await policyDigest(reordered)).toBe(await policyDigest(p));
  expect(await policyDigest(p)).toMatch(/^[a-f0-9]{64}$/);
});

test("every spending/domain/rule change changes the bound hash", async () => {
  const p = policyFixture();
  const hash = await policyDigest(p);
  const changes = [
    { owner: "different-owner" }, { keeper: "different-keeper" }, { recipient: "different-recipient" },
    { source: "different-source" }, { input: { ...p.input, address: "different-mint" } },
    { output: { ...p.output, address: "different-output" } }, { slippageBps: p.slippageBps + 1 },
    { amountRaw: "101" }, { minimumOutputRaw: "91" }, { expiresAt: p.expiresAt + 1 },
    { guard: "different-guard" }, { guardVersion: "guard@2" }, { routeId: "route-2" },
    { orderId: "02".repeat(32) }, { chain: { ...p.chain, reference: "different-network" } },
    { rule: { ...p.rule, thresholdBps: p.rule.thresholdBps + 1 } },
    { rule: { ...p.rule, maxImpactBps: p.rule.maxImpactBps + 1 } },
    { rule: { ...p.rule, maxOutputDeviationBps: p.rule.maxOutputDeviationBps + 1 } },
    { coverage: { ...p.coverage, programVersion: "slot-2" } },
  ];
  for (const change of changes) expect(await policyDigest({ ...p, ...change })).not.toBe(hash);
});

test("catalog edits cannot silently widen an already signed policy", () => {
  const p = policyFixture();
  for (const field of ["venue", "pool", "program", "programVersion"] as const) {
    const changed = catalogFixture();
    changed.routes[0]![field] = "replacement";
    expect(() => validatePolicy(p, changed, 0)).toThrow();
  }
  const changed = catalogFixture();
  changed.assets[0]!.reference.instrument = "different-stock";
  expect(() => validatePolicy(p, changed, 0)).toThrow();
  expect(() => validatePolicy({ ...p, unapproved: true } as typeof p, catalogFixture(), 0)).toThrow();
});

test("policy rejects mismatched domains, excessive slippage and noncanonical amounts", () => {
  const catalog = validateCatalog(catalogFixture());
  const p = policyFixture();
  expect(() => validatePolicy(p, catalog, p.expiresAt - 60)).not.toThrow();
  for (const amountRaw of ["0", "-1", "01", "1.1", "1e3"]) {
    expect(() => validatePolicy({ ...p, amountRaw }, catalog, p.expiresAt - 60)).toThrow();
  }
  expect(() => validatePolicy({ ...p, slippageBps: 10_001 }, catalog, 0)).toThrow();
  expect(() => validatePolicy(p, catalog, p.expiresAt)).toThrow();
  expect(() => validatePolicy({ ...p, routeId: "unknown" }, catalog, 0)).toThrow();
  expect(() => validatePolicy({ ...p, keeper: "" }, catalog, 0)).toThrow();
  for (const field of ["maxImpactBps", "maxOutputDeviationBps"] as const) {
    for (const value of [-1, 10000, 10001, 0.5, undefined]) {
      expect(() => validatePolicy({ ...p, rule: { ...p.rule, [field]: value } } as typeof p, catalog, 0)).toThrow();
    }
  }
  expect(() => validatePolicy({ ...p, output: { ...p.output, chain: { ...p.chain, reference: "other" } } }, catalog, 0)).toThrow();
});
