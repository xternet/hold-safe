import type { Outcome } from "../../_0_types/mod";
export type WalletHolding = {
  account: string; balanceRaw: string; delegate: string | null; allowanceRaw: string;
  multiplier: { n: string; d: string }; sourceAtMs: number;
};
export type WalletInventory = {
  owner: string; routeId: string; recipient: string; receivedAtMs: number;
  holdings: WalletHolding[]; excluded: { account: string; reason: string }[];
};
export interface WalletInventoryPort {
  list(owner: string, routeId: string): Promise<Outcome<WalletInventory>>;
}
