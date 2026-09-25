import { assetKey, chainKey, type Catalog } from "../_0_types/mod";

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
function text(value: string, label: string): void {
  if (typeof value !== "string" || !value || value.trim() !== value) throw new Error(`Missing/invalid ${label}`);
}
function evidence(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Missing/invalid compatibility evidence hash");
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateCatalog(input: Catalog): Catalog {
  const catalog = structuredClone(input);
  if (catalog.schema !== 1) throw new Error("Unsupported catalog schema");
  for (const name of ["chains", "feeds", "assets", "routes"] as const) {
    if (!Array.isArray(catalog[name]) || catalog[name].length === 0) throw new Error(`Empty ${name} catalog`);
  }
  unique(catalog.chains.map((c) => c.id), "chain adapter ID");
  unique(catalog.chains.map((c) => chainKey(c.chain)), "chain domain");
  unique(catalog.feeds.map((f) => f.id), "feed adapter ID");
  unique(catalog.assets.map((a) => assetKey(a.ref)), "asset identity");
  unique(catalog.routes.map((r) => r.id), "route ID");
  for (const capability of catalog.chains) {
    text(capability.id, "chain adapter ID");
    if (!capability.profiles.length || !capability.venues.length) throw new Error("Empty chain capabilities");
    for (const value of [...capability.profiles, ...capability.venues]) text(value, "chain capability");
    unique(capability.profiles, "token profile"); unique(capability.venues, "venue");
  }
  for (const feed of catalog.feeds) {
    text(feed.id, "feed ID");
    if (!["consolidated", "venue"].includes(feed.coverage) || !feed.instruments.length) throw new Error("Invalid feed capability");
    for (const instrument of feed.instruments) text(instrument, "feed instrument");
    unique(feed.instruments, "feed instrument");
  }
  for (const asset of catalog.assets) {
    text(asset.symbol, "symbol"); evidence(asset.evidenceHash);
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) throw new Error("Invalid asset decimals");
    const chain = catalog.chains.find((c) => chainKey(c.chain) === chainKey(asset.ref.chain));
    if (chain === undefined || !chain.profiles.includes(asset.profile)) throw new Error("Unsupported asset profile/domain");
    const feed = catalog.feeds.find((f) => f.id === asset.reference.provider);
    if (feed === undefined || !feed.instruments.includes(asset.reference.instrument) ||
        feed.coverage !== asset.reference.coverage || asset.reference.currency !== "USD") {
      throw new Error("Unsupported reference mapping/coverage");
    }
  }
  for (const route of catalog.routes) {
    for (const value of [route.id, route.adapter, route.venue, route.pool, route.program, route.programVersion, route.guardVersion]) text(value, "route field");
    evidence(route.evidenceHash);
    const chain = catalog.chains.find((c) => c.id === route.adapter);
    if (chain === undefined || chainKey(chain.chain) !== chainKey(route.chain) || !chain.venues.includes(route.venue)) throw new Error("Unsupported route capability");
    if (assetKey(route.input) === assetKey(route.output)) throw new Error("Exit assets must differ");
    for (const asset of [route.input, route.output]) {
      if (chainKey(asset.chain) !== chainKey(route.chain) || !catalog.assets.some((a) => assetKey(a.ref) === assetKey(asset))) {
        throw new Error("Unsupported route asset/domain");
      }
    }
  }
  return freeze(catalog);
}
