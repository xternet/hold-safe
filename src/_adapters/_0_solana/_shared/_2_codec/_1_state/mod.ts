import { PublicKey } from "@solana/web3.js";
import type { Policy } from "../../../../../_kernel/mod";
import { GUARD, nativePolicy } from "../../_0_identity/mod";
import { discriminator, policyAddress, routeMetas, stagingAddress } from "../_shared/mod";

export type NativePolicy = {
  state: "active" | "consumed" | "revoked"; owner: string; keeper: string; source: string;
  staging: string; recipient: string; orderId: string; digest: string; amount: string;
  minimumOutput: string; expiresAt: number; route: string[];
};
export function decodePolicy(account: { owner: PublicKey; data: Buffer }, address: PublicKey, guard = GUARD): NativePolicy {
  const d = account.data;
  if (!account.owner.equals(guard) || d.length !== 579 || !d.subarray(0, 8).equals(discriminator("account", "Policy")) || d[8] !== 1) throw new Error("Invalid guard policy account/schema");
  const state = d[9] === 1 ? "active" : d[9] === 2 ? "consumed" : d[9] === 3 ? "revoked" : null;
  if (state === null) throw new Error("Unknown native policy state");
  let cursor = 11;
  const key = () => { const value = new PublicKey(d.subarray(cursor, cursor + 32)).toBase58(); cursor += 32; return value; };
  const hex = () => { const value = d.subarray(cursor, cursor + 32).toString("hex"); cursor += 32; return value; };
  const amount = () => { const value = d.readBigUInt64LE(cursor).toString(); cursor += 8; return value; };
  const owner = key(), keeper = key(), source = key(), staging = key(), recipient = key(), orderId = hex(), digest = hex();
  const input = amount(), minimumOutput = amount(), expiresAt = Number(d.readBigInt64LE(cursor)); cursor += 8;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0 || !policyAddress({ owner, orderId, guard: guard.toBase58() }).equals(address)) throw new Error("Invalid native policy time/address");
  const expectedBump = PublicKey.findProgramAddressSync([Buffer.from("policy"), new PublicKey(owner).toBuffer(), Buffer.from(orderId, "hex")], guard)[1];
  if (d[10] !== expectedBump) throw new Error("Invalid policy bump");
  const route = Array.from({ length: 10 }, key);
  return { state, owner, keeper, source, staging, recipient, orderId, digest, amount: input, minimumOutput, expiresAt, route };
}

export function assertPolicyBinding(policy: Policy, digest: string, native: NativePolicy): void {
  nativePolicy(policy); routeMetas(policy, native.route);
  if (native.digest !== digest || native.owner !== policy.owner || native.keeper !== policy.keeper || native.source !== policy.source ||
      native.recipient !== policy.recipient || native.staging !== stagingAddress(policy).toBase58() || native.orderId !== policy.orderId ||
      native.amount !== policy.amountRaw || native.minimumOutput !== policy.minimumOutputRaw || native.expiresAt !== policy.expiresAt) {
    throw new Error("Onchain policy differs from requested immutable authorization");
  }
}
