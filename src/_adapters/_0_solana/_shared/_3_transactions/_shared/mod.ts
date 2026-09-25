import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { ComputeBudgetProgram } from "@solana/web3.js";
import { parseRaw } from "../../../../../_kernel/mod";

export type BlockValidity = { blockhash: string; lastValidBlockHeight: number; contextSlot: number };
export type FeeSettings = { computeUnitLimit: number; microLamports: string; baseFeeLamports: string; maxFeeLamports: string };
export type SolanaValidity = BlockValidity & {
  purpose: "arm" | "revoke" | "exit"; policyDigest: string; policyAddress: string;
  quoteExpiresAtMs?: number;
  feePayer: string; messageHash: string; maxFeeLamports: string;
};
export const hashMessage = (bytes: Uint8Array) => Buffer.from(sha256(bytes)).toString("hex");
export function budget(fees: FeeSettings) {
  if (!Number.isSafeInteger(fees.computeUnitLimit) || fees.computeUnitLimit <= 0 || fees.computeUnitLimit > 1_400_000) throw new Error("Invalid compute-unit cap");
  const price = parseRaw(fees.microLamports, true);
  if (price > 0xffffffffffffffffn) throw new Error("Priority price exceeds native u64");
  const priority = (BigInt(fees.computeUnitLimit) * price + 999_999n) / 1_000_000n;
  // Caller supplies the current RPC base fee; signing must recheck total RPC fee.
  if (parseRaw(fees.baseFeeLamports) + priority > parseRaw(fees.maxFeeLamports)) throw new Error("Transaction exceeds fee cap");
  return [ComputeBudgetProgram.setComputeUnitLimit({ units: fees.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })];
}
