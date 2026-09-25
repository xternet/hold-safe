import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ClmmInstrument, PoolInfoLayout, getPdaExBitmapAccount } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { DEX, POOL, MAINNET_GENESIS, type Snapshot } from "../../_2_swap/_shared/mod";
import type { makeAccounts } from "../../_2_swap/_1_fixture/_1_accounts/mod";

export const GUARD = new PublicKey("HNpQ9dn9Prr97FrQQoU3auhRgHiAsCWwsTy45kde9yvL");
export const ORDER = Buffer.alloc(32, 11); // Local test order, not a private key.
export const HASH = Buffer.alloc(32, 12); // Local policy fixture digest.
export const key = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
export const discr = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
export function u64(value: bigint): Buffer { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes; }
export type Actors = ReturnType<typeof makeAccounts> & { policy: PublicKey };
export function route(snapshot: Snapshot, a: Actors) {
  const captured = snapshot.accounts.find((account) => account.address === POOL);
  if (captured === undefined) throw new Error("Missing route fixture");
  const p = PoolInfoLayout.decode(Buffer.from(captured.data, "base64"));
  return { p, keys: [key(p.mintA), key(p.mintB), key(TOKEN_2022_PROGRAM_ID), key(TOKEN_PROGRAM_ID),
    key(new PublicKey(DEX)), key(new PublicKey(POOL), true), key(p.configId),
    key(p.vaultA, true), key(p.vaultB, true), key(p.observationId, true)],
    swap: ClmmInstrument.swapV2Instruction(new PublicKey(DEX), a.policy, new PublicKey(POOL), p.configId,
      a.staging, a.output, p.vaultA, p.vaultB, p.mintA, p.mintB,
      snapshot.ticks.map((tick) => new PublicKey(tick)), p.observationId,
      new BN(a.amount.toString()), new BN(1), new BN(0), true,
      getPdaExBitmapAccount(new PublicKey(DEX), new PublicKey(POOL)).publicKey) };
}
export function authorize(snapshot: Snapshot, a: Actors, now: bigint, options: {
  amount?: bigint; floor?: bigint; expiry?: bigint; replace?: boolean; version?: number; domain?: PublicKey;
} = {}) {
  const expiry = options.expiry === undefined ? now + 3600n : options.expiry;
  const amount = options.amount === undefined ? a.amount : options.amount;
  const floor = options.floor === undefined ? 1n : options.floor;
  const version = options.version === undefined ? 1 : options.version;
  const domain = options.domain === undefined ? new PublicKey(MAINNET_GENESIS) : options.domain;
  return new TransactionInstruction({ programId: GUARD, keys: [
    key(a.owner.publicKey, true, true), key(a.policy, true), key(a.keeper.publicKey),
    key(a.source, true), key(a.staging), key(a.output), ...route(snapshot, a).keys, key(SystemProgram.programId),
  ], data: Buffer.concat([discr("authorize"), ORDER, HASH, domain.toBuffer(), Buffer.from([version]),
    u64(amount), u64(floor), u64(expiry), Buffer.from([options.replace === true ? 1 : 0])]) });
}
export function execute(snapshot: Snapshot, a: Actors, floor = 0n) {
  const r = route(snapshot, a);
  return new TransactionInstruction({ programId: GUARD, keys: [key(a.keeper.publicKey, false, true),
    key(a.policy, true), key(a.source, true), key(a.staging, true), key(a.output, true),
    ...r.keys, r.swap.keys[10]!, ...r.swap.keys.slice(13)],
    data: Buffer.concat([discr("execute"), u64(floor)]) });
}
export function revoke(a: Actors) {
  return new TransactionInstruction({ programId: GUARD, keys: [key(a.owner.publicKey, false, true),
    key(a.policy, true), key(a.source, true), key(TOKEN_2022_PROGRAM_ID)], data: discr("revoke") });
}
