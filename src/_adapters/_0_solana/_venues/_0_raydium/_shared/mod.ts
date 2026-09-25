import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import type { Rational } from "../../../../../_kernel/mod";

export type NativeBatch = { slot: number; accounts: Map<string, AccountInfo<Buffer>>; observedAtMs: number; programVersion: string };
export type NativeQuote = {
  outputRaw: string; minimumOutputRaw: string; inputRaw: string; routeKeys: string[]; ticks: string[];
  slot: number; sourceAtMs: number; observedAtMs: number; stateHash: string; programVersion: string;
  sampleInputRaw: string; sampleOutputRaw: string; priceImpactBps: Rational;
};
export function account(batch: NativeBatch, key: PublicKey): AccountInfo<Buffer> {
  const value = batch.accounts.get(key.toBase58());
  if (value === undefined) throw new Error(`Missing native account ${key}`);
  return value;
}
export function stateHash(batch: NativeBatch): string {
  const hash = createHash("sha256");
  for (const [key, value] of [...batch.accounts.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(key).update(value.owner.toBuffer()).update(value.data);
  }
  return hash.digest("hex");
}
export function quoteJson(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
}
