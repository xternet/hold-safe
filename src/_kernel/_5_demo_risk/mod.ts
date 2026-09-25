import type { DemoProtections, DemoRiskRule } from "../_0_types/mod";
export function validateDemoProtections(value:unknown):DemoProtections {
  if(typeof value!=="object"||value===null||Array.isArray(value))throw new Error("Choose at least one protection");
  const record=value as Record<string,unknown>;
  if(Object.keys(record).length!==2||typeof record.priceDrop!=="boolean"||typeof record.supplySpike!=="boolean"||(!record.priceDrop&&!record.supplySpike))
    throw new Error("Choose at least one supported protection");
  return {priceDrop:record.priceDrop,supplySpike:record.supplySpike};
}
export function demoProtections(rule:DemoRiskRule):DemoProtections {
  if(rule.version===1)return {priceDrop:true,supplySpike:true};
  if(rule.version===2)return validateDemoProtections(rule.protections);
  throw new Error("Unsupported demo rule version");
}
export type DemoPersistence = { reason: string; chainStart: number; referenceStart: number; last: number };
export function demoRisk(s: { now: number; chainAt: number; referenceAt: number; quoteRaw: bigint; referenceRaw: bigint;
  supply: bigint; baselineSupply: bigint; frozen: boolean; protections?:DemoProtections; previous: DemoPersistence | null }) {
  const unavailable = (reason: string) => ({ trigger: false, next: null, reason });
  if (s.frozen) return unavailable("Token frozen: an exit cannot bypass issuer restrictions");
  if (s.referenceRaw <= 0n || s.baselineSupply <= 0n || [s.chainAt,s.referenceAt].some(t=>t>s.now||s.now-t>=5000)) return unavailable("Waiting for fresh reference and chain observations");
  const enabled=s.protections===undefined?{priceDrop:true,supplySpike:true}:validateDemoProtections(s.protections);
  const reason = enabled.supplySpike && s.supply * 10000n > s.baselineSupply * 11000n ? "Supply increased more than 10%" :
    enabled.priceDrop && s.quoteRaw * 10000n <= s.referenceRaw * 9700n ? "Executable price fell at least 3% below reference" : "";
  if (reason === "") return unavailable("No risk condition detected");
  const old = s.previous;
  const next = old !== null && old.reason === reason && s.now >= old.last && s.now-old.last<5000 && s.chainAt>=old.chainStart && s.referenceAt>=old.referenceStart
    ? { ...old, last:s.now } : { reason, chainStart:s.chainAt, referenceStart:s.referenceAt, last:s.now };
  return { trigger: Math.min(s.chainAt-next.chainStart,s.referenceAt-next.referenceStart)>=3000, next, reason };
}
