import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Policy } from "../../../../../_kernel/mod";
import { GUARD, nativePolicy } from "../../_0_identity/mod";

export const discriminator = (domain: string, name: string) => Buffer.from(sha256(new TextEncoder().encode(`${domain}:${name}`))).subarray(0, 8);
export const meta = (key: string | PublicKey, isWritable = false, isSigner = false) => ({ pubkey: new PublicKey(key), isWritable, isSigner });
export function u64(value: string): Buffer {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 0xffffffffffffffffn) throw new Error("Invalid native unsigned amount");
  const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data;
}
export function policyAddress(policy: Pick<Policy, "owner" | "orderId"> & Partial<Pick<Policy, "guard">>): PublicKey {
  if (!/^[a-f0-9]{64}$/.test(policy.orderId) || policy.orderId === "00".repeat(32)) throw new Error("Invalid order ID");
  return PublicKey.findProgramAddressSync([Buffer.from("policy"), new PublicKey(policy.owner).toBuffer(), Buffer.from(policy.orderId, "hex")], policy.guard === undefined ? GUARD : new PublicKey(policy.guard))[0];
}
export function stagingAddress(policy: Policy): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(policy.input.address), policyAddress(policy), true, TOKEN_2022_PROGRAM_ID);
}
export function routeMetas(policy: Policy, route: string[]) {
  const { dex: DEX } = nativePolicy(policy);
  if (route.length !== 10 || new Set(route).size !== 10 || route[0] !== policy.input.address || route[1] !== policy.output.address ||
      route[2] !== TOKEN_2022_PROGRAM_ID.toBase58() || route[3] !== TOKEN_PROGRAM_ID.toBase58() ||
      route[4] !== DEX.toBase58() || route[5] !== policy.coverage.pool) throw new Error("Guard route mismatch");
  return route.map((key, index) => meta(key, [5, 7, 8, 9].includes(index)));
}
