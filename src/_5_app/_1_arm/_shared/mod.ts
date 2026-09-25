import type { PolicyPreview } from "../../../_kernel/mod";
export type Reviewed = { preview: PolicyPreview; maximumNetworkFeeRaw: string; replaceExistingApproval: boolean };
export function scaledDisplay(raw: string, decimals: number, multiplier: { n: string; d: string }): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || !/^(0|[1-9][0-9]*)$/.test(raw) ||
      !/^[1-9][0-9]*$/.test(multiplier.n) || !/^[1-9][0-9]*$/.test(multiplier.d)) throw new Error("Invalid balance units");
  const denominator = 10n ** BigInt(decimals) * BigInt(multiplier.d), numerator = BigInt(raw) * BigInt(multiplier.n);
  if (denominator <= 0n || numerator < 0n) throw new Error("Invalid balance units");
  const scaled = numerator * 100000000n / denominator;
  return `${scaled / 100000000n}.${(scaled % 100000000n).toString().padStart(8, "0")}`;
}
