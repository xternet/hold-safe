import type { Connection } from "@solana/web3.js";
import type { Catalog, Fault, Policy, Receipt } from "../../../../../_kernel/mod";
import type { FeeGate } from "../../../_shared/_6_fees/mod";
import type { GuardManifest } from "../../../_shared/_5_guard/mod";
export type RpcSource = { id: string; connection: Connection };
export type DeliveryOptions = {
  primary: RpcSource; backup: RpcSource; catalog: Catalog; manifest: GuardManifest; keeper: string;
  policy: (digest: string) => Promise<Policy>; fees: FeeGate; log: (fault: Fault) => void; now: () => number;
};
export class DeliveryError extends Error {}
export function receipt(nativeId: string, state: Receipt["state"], now: number, detail: unknown): Receipt {
  return { nativeId, state, checkedAtMs: now, context: { adapter: "solana-receipt", version: 1, serialized: JSON.stringify(detail) } };
}
