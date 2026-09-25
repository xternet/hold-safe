import { assetKey, copyValue, parseRaw, validateCatalog, validatePolicy, type Catalog, type Policy } from "../../../_kernel/mod";

export type Coverage = { catalog: Catalog; keeper: string; guard: string };
export type DraftFields = { source: string; recipient: string; amountRaw: string; minimumOutput: string;
  thresholdPercent: string; persistenceSeconds: string; slippagePercent: string; lifetimeHours: string };
export function decimalRaw(input: string, decimals: number, zero = false): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || input.length > 80 ||
      !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(input)) throw new Error("Enter an exact positive decimal amount");
  const [whole, fraction] = input.split("."), digits = fraction === undefined ? "" : fraction;
  if (digits.length > decimals) throw new Error("Amount exceeds supported decimal precision");
  const fractional = digits.length === 0 ? 0n : BigInt(digits.padEnd(decimals, "0"));
  const raw = BigInt(whole!) * 10n ** BigInt(decimals) + fractional;
  if (raw === 0n && !zero) throw new Error("Amount must be positive");
  return raw.toString();
}
function boundedNumber(input: string, decimals: number, maximum: bigint, zero = false): number {
  const raw = BigInt(decimalRaw(input, decimals, zero));
  if (raw > maximum) throw new Error("Value exceeds supported bound");
  return Number(raw);
}
export function makeDraft(input: Coverage, owner: string, routeId: string, fields: DraftFields, nowMs: number): Policy {
  const catalog = validateCatalog(copyValue(input.catalog)), route = catalog.routes.find(item => item.id === routeId);
  if (route === undefined) throw new Error("Unsupported route");
  const asset = catalog.assets.find(item => assetKey(item.ref) === assetKey(route.input));
  const output = catalog.assets.find(item => assetKey(item.ref) === assetKey(route.output));
  if (asset === undefined || output === undefined) throw new Error("Missing asset accounting");
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("Current time unavailable");
  parseRaw(fields.amountRaw);
  const lifetimeSeconds = boundedNumber(fields.lifetimeHours, 0, 720n) * 3600;
  const policy: Policy = { schema: 1, chain: route.chain,
    orderId: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""),
    owner, keeper: input.keeper, guard: input.guard, guardVersion: route.guardVersion,
    source: fields.source, recipient: fields.recipient, input: route.input, output: route.output, routeId,
    amountRaw: fields.amountRaw, minimumOutputRaw: decimalRaw(fields.minimumOutput, output.decimals),
    slippageBps: boundedNumber(fields.slippagePercent, 2, 10000n, true), expiresAt: Math.floor(nowMs / 1000) + lifetimeSeconds,
    rule: { id: "divergence", version: 1, thresholdBps: boundedNumber(fields.thresholdPercent, 2, 10000n),
      persistenceMs: boundedNumber(fields.persistenceSeconds, 3, 3600000n), maxAgeMs: 5000, maxSkewMs: 2000,
      maxImpactBps: 100, maxOutputDeviationBps: 100 },
    coverage: { inputProfile: asset.profile, outputProfile: output.profile, inputReference: asset.reference,
      outputReference: output.reference, venue: route.venue, pool: route.pool, program: route.program, programVersion: route.programVersion } };
  validatePolicy(policy, catalog, Math.floor(nowMs / 1000)); return copyValue(policy);
}
