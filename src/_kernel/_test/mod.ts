import type { Catalog, Policy } from "../_0_types/mod";

// Explicit synthetic unit fixtures. These addresses/guards are never enabled.
export function catalogFixture(): Catalog {
  const chain = { namespace: "solana", reference: "unit-test-network" };
  const input = { chain: { ...chain }, address: "StockMint" };
  const output = { chain: { ...chain }, address: "UsdMint" };
  return structuredClone({ schema: 1,
    chains: [{ id: "solana", chain, profiles: ["scaled-v1", "token-v1"], venues: ["clmm"] }],
    feeds: [{ id: "stocks", instruments: ["AAPL"], coverage: "consolidated" },
      { id: "usd", instruments: ["USDC/USD"], coverage: "venue" }],
    assets: [
      { ref: input, symbol: "STOCK", decimals: 8, profile: "scaled-v1", evidenceHash: "ab".repeat(32),
        reference: { provider: "stocks", instrument: "AAPL", currency: "USD", coverage: "consolidated" } },
      { ref: output, symbol: "USD", decimals: 6, profile: "token-v1", evidenceHash: "cd".repeat(32),
        reference: { provider: "usd", instrument: "USDC/USD", currency: "USD", coverage: "venue" } },
    ],
    routes: [{ id: "route-1", chain: { ...chain }, input: structuredClone(input), output: structuredClone(output), adapter: "solana", venue: "clmm",
      pool: "pool", program: "program", programVersion: "slot-1", guardVersion: "guard@1", evidenceHash: "ef".repeat(32) }],
  });
}

export function policyFixture(): Policy {
  const chain = { namespace: "solana", reference: "unit-test-network" };
  return { schema: 1, chain, orderId: "01".repeat(32), owner: "owner", keeper: "keeper", source: "source",
    input: { chain: { ...chain }, address: "StockMint" }, output: { chain: { ...chain }, address: "UsdMint" },
    amountRaw: "100", recipient: "recipient", minimumOutputRaw: "90", slippageBps: 100,
    expiresAt: 2_000_000_000, guard: "guard", guardVersion: "guard@1", routeId: "route-1",
    rule: { id: "divergence", version: 1, thresholdBps: 300, persistenceMs: 3000, maxAgeMs: 5000, maxSkewMs: 2000, maxImpactBps: 100, maxOutputDeviationBps: 100 },
    coverage: { inputProfile: "scaled-v1", outputProfile: "token-v1",
      inputReference: { provider: "stocks", instrument: "AAPL", currency: "USD", coverage: "consolidated" },
      outputReference: { provider: "usd", instrument: "USDC/USD", currency: "USD", coverage: "venue" },
      venue: "clmm", pool: "pool", program: "program", programVersion: "slot-1" },
  };
}
