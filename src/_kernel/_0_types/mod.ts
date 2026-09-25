export type ChainRef = { namespace: string; reference: string };
export type AssetRef = { chain: ChainRef; address: string };
export type RawAmount = { asset: AssetRef; raw: string };
export type ReferenceMapping = {
  provider: string; instrument: string; currency: "USD";
  coverage: "consolidated" | "venue";
};
export type AssetSpec = {
  ref: AssetRef; symbol: string; decimals: number; profile: string;
  reference: ReferenceMapping; evidenceHash: string;
};
export type RouteSpec = {
  id: string; chain: ChainRef; input: AssetRef; output: AssetRef;
  adapter: string; venue: string; pool: string; program: string;
  programVersion: string; guardVersion: string; evidenceHash: string;
};
export type ChainCapability = { id: string; chain: ChainRef; profiles: string[]; venues: string[] };
export type FeedCapability = { id: string; instruments: string[]; coverage: ReferenceMapping["coverage"] };
export type Catalog = { schema: 1; chains: ChainCapability[]; feeds: FeedCapability[]; assets: AssetSpec[]; routes: RouteSpec[] };
export type DivergenceRule = {
  id: "divergence"; version: 1; thresholdBps: number; persistenceMs: number;
  maxAgeMs: number; maxSkewMs: number; maxImpactBps: number; maxOutputDeviationBps: number;
};
export type DemoProtections = { priceDrop: boolean; supplySpike: boolean };
export type DemoRiskRule = Omit<DivergenceRule, "id" | "version"> & { id: "demo-risk"; supplyBaselineRaw: string; referenceMode: "replay" | "live" }
  & ({ version: 1 } | { version: 2; protections: DemoProtections });
export type Policy = {
  schema: 1; chain: ChainRef; orderId: string; owner: string; keeper: string; source: string;
  input: AssetRef; output: AssetRef; amountRaw: string; recipient: string;
  minimumOutputRaw: string; slippageBps: number; expiresAt: number;
  guard: string; guardVersion: string; routeId: string; rule: DivergenceRule | DemoRiskRule;
  coverage: {
    inputProfile: string; outputProfile: string;
    inputReference: ReferenceMapping; outputReference: ReferenceMapping;
    venue: string; pool: string; program: string; programVersion: string;
  };
};
export type Fault = {
  code: "UNSUPPORTED" | "UNAVAILABLE" | "INVALID" | "FAILED";
  message: string; retryable: boolean; context: Record<string, string>;
};
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: Fault };
export type Health = { source: string; healthy: boolean; checkedAt: number; reason: string };

export function chainKey(chain: ChainRef): string {
  if (typeof chain.namespace !== "string" || !/^[a-z][a-z0-9_-]*$/.test(chain.namespace) || typeof chain.reference !== "string" || !chain.reference || chain.reference.trim() !== chain.reference) {
    throw new Error("Invalid chain namespace/reference");
  }
  return JSON.stringify([chain.namespace, chain.reference]);
}

export function assetKey(asset: AssetRef): string {
  chainKey(asset.chain);
  if (typeof asset.address !== "string" || !asset.address || asset.address.trim() !== asset.address) {
    throw new Error("Invalid native asset address");
  }
  return JSON.stringify([asset.chain.namespace, asset.chain.reference, asset.address]);
}

export function parseRaw(value: string, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("Invalid canonical raw amount");
  const raw = BigInt(value);
  if (!allowZero && raw === 0n) throw new Error("Amount must be positive");
  return raw;
}
