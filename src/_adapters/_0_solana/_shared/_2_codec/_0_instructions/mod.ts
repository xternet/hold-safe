import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import type { Policy } from "../../../../../_kernel/mod";
import { MEMO, nativePolicy } from "../../_0_identity/mod";
import { discriminator, meta, policyAddress, routeMetas, stagingAddress, u64 } from "../_shared/mod";

export function authorizeInstruction(policy: Policy, digest: string, route: string[], replaceDelegate: boolean): TransactionInstruction {
  const { guard: GUARD } = nativePolicy(policy);
  const routeKeys = routeMetas(policy, route);
  if (!/^[a-f0-9]{64}$/.test(digest) || digest === "00".repeat(32) || !Number.isSafeInteger(policy.expiresAt) || policy.expiresAt <= 0) throw new Error("Invalid policy digest/expiry");
  return new TransactionInstruction({ programId: GUARD, keys: [
    meta(policy.owner, true, true), meta(policyAddress(policy), true), meta(policy.keeper),
    meta(policy.source, true), meta(stagingAddress(policy)), meta(policy.recipient), ...routeKeys, meta(SystemProgram.programId),
  ], data: Buffer.concat([discriminator("global", "authorize"), Buffer.from(policy.orderId, "hex"), Buffer.from(digest, "hex"),
    new PublicKey(policy.chain.reference).toBuffer(), Buffer.from([1]), u64(policy.amountRaw), u64(policy.minimumOutputRaw),
    u64(String(policy.expiresAt)), Buffer.from([replaceDelegate ? 1 : 0])]) });
}

export type GuardSwap = { inputRaw: string; outputRaw: string; minimumOutputRaw: string; routeKeys: string[]; ticks: string[] };
export function executeInstruction(policy: Policy, quote: GuardSwap): TransactionInstruction {
  const { guard: GUARD, dex: DEX } = nativePolicy(policy);
  const route = routeMetas(policy, quote.routeKeys);
  const bitmap = PublicKey.findProgramAddressSync([Buffer.from("pool_tick_array_bitmap_extension"), new PublicKey(policy.coverage.pool).toBuffer()], DEX)[0].toBase58();
  if (quote.inputRaw !== policy.amountRaw || BigInt(quote.minimumOutputRaw) < BigInt(policy.minimumOutputRaw) ||
      BigInt(quote.minimumOutputRaw) > BigInt(quote.outputRaw) || quote.ticks[0] !== bitmap || quote.ticks.length < 2 ||
      quote.ticks.length > 7 || new Set(quote.ticks).size !== quote.ticks.length) throw new Error("Invalid bounded swap quote");
  return new TransactionInstruction({ programId: GUARD, keys: [meta(policy.keeper, false, true),
    meta(policyAddress(policy), true), meta(policy.source, true), meta(stagingAddress(policy), true),
    meta(policy.recipient, true), ...route, meta(MEMO), ...quote.ticks.map((tick) => meta(tick, true))],
    data: Buffer.concat([discriminator("global", "execute"), u64(quote.minimumOutputRaw)]) });
}

export function revokeInstruction(policy: Policy): TransactionInstruction {
  const { guard: GUARD } = nativePolicy(policy);
  return new TransactionInstruction({ programId: GUARD, keys: [meta(policy.owner, false, true),
    meta(policyAddress(policy), true), meta(policy.source, true), meta(TOKEN_2022_PROGRAM_ID)], data: discriminator("global", "revoke") });
}
