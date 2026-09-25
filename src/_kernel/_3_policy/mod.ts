import { validateDemoProtections } from "../_5_demo_risk/mod";
import { assetKey, chainKey, parseRaw, type Catalog, type Policy } from "../_0_types/mod";

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  throw new Error("Noncanonical policy value");
}

export function canonicalPolicy(policy: Policy): string {
  return canonical({ domain: "solstock-guard-policy", version: 1, policy });
}
export async function policyDigest(policy: Policy): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPolicy(policy));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function validatePolicy(policy: Policy, catalog: Catalog, nowSeconds: number): void {
  const allowed = ["schema", "chain", "orderId", "owner", "keeper", "source", "input", "output", "amountRaw", "recipient",
    "minimumOutputRaw", "slippageBps", "expiresAt", "guard", "guardVersion", "routeId", "rule", "coverage"];
  if (Object.keys(policy).length !== allowed.length || Object.keys(policy).some((key) => !allowed.includes(key))) throw new Error("Unknown/missing policy field");
  if (policy.schema !== 1 || !["divergence", "demo-risk"].includes(policy.rule.id) || (policy.rule.version !== 1 && !(policy.rule.id === "demo-risk" && policy.rule.version === 2))) throw new Error("Unsupported policy/rule version");
  if (!/^[a-f0-9]{64}$/.test(policy.orderId)) throw new Error("Invalid order identity");
  for (const field of ["owner", "keeper", "source", "recipient", "guard", "guardVersion", "routeId"] as const) {
    if (typeof policy[field] !== "string" || !policy[field] || policy[field].trim() !== policy[field]) throw new Error(`Missing/invalid ${field}`);
  }
  parseRaw(policy.amountRaw); parseRaw(policy.minimumOutputRaw);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0 || !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= nowSeconds) throw new Error("Expired/invalid policy time");
  if (!Number.isInteger(policy.slippageBps) || policy.slippageBps < 0 || policy.slippageBps > 10_000) throw new Error("Invalid slippage bound");
  const rule = policy.rule;
  const ruleFields = ["id", "version", "thresholdBps", "persistenceMs", "maxAgeMs", "maxSkewMs", "maxImpactBps", "maxOutputDeviationBps"];
  if (rule.id === "demo-risk") {
    ruleFields.push("supplyBaselineRaw", "referenceMode");
    if(rule.version===2){ruleFields.push("protections");validateDemoProtections(rule.protections);}
    parseRaw(rule.supplyBaselineRaw);
    if (!["replay", "live"].includes(rule.referenceMode)) throw new Error("Invalid demo reference mode");
    if (rule.thresholdBps !== 300 || rule.persistenceMs !== 3000) throw new Error("Unsupported demo thresholds");
  }
  if (Object.keys(rule).length !== ruleFields.length || Object.keys(rule).some(key => !ruleFields.includes(key))) throw new Error("Unknown/missing rule field");
  if (!Number.isInteger(rule.thresholdBps) || rule.thresholdBps <= 0 || rule.thresholdBps > 10_000) throw new Error("Invalid divergence threshold");
  for (const bound of [rule.maxImpactBps, rule.maxOutputDeviationBps]) {
    if (!Number.isInteger(bound) || bound < 0 || bound >= 10_000) throw new Error("Invalid impact/output valuation bound");
  }
  for (const interval of [rule.persistenceMs, rule.maxAgeMs, rule.maxSkewMs]) {
    if (!Number.isSafeInteger(interval) || interval <= 0) throw new Error("Invalid rule interval");
  }
  const route = catalog.routes.find((entry) => entry.id === policy.routeId);
  if (route === undefined || route.guardVersion !== policy.guardVersion ||
      chainKey(route.chain) !== chainKey(policy.chain) || assetKey(route.input) !== assetKey(policy.input) ||
      assetKey(route.output) !== assetKey(policy.output)) throw new Error("Policy route/domain mismatch");
  for (const field of ["venue", "pool", "program", "programVersion"] as const) {
    if (policy.coverage[field] !== route[field]) throw new Error(`Changed policy route ${field}`);
  }
  const input = catalog.assets.find((asset) => assetKey(asset.ref) === assetKey(policy.input));
  const output = catalog.assets.find((asset) => assetKey(asset.ref) === assetKey(policy.output));
  if (input === undefined || output === undefined || input.profile !== policy.coverage.inputProfile ||
      output.profile !== policy.coverage.outputProfile || canonical(input.reference) !== canonical(policy.coverage.inputReference) ||
      canonical(output.reference) !== canonical(policy.coverage.outputReference)) throw new Error("Changed policy accounting/reference coverage");
  if (policy.rule.id === "divergence" && input.reference.coverage !== "consolidated") throw new Error("Divergence v1 requires consolidated stock coverage");
  canonicalPolicy(policy);
}
