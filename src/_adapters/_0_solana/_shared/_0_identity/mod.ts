import { PublicKey } from "@solana/web3.js";
import type { Policy } from "../../../../_kernel/mod";

export const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const GUARD = new PublicKey("HNpQ9dn9Prr97FrQQoU3auhRgHiAsCWwsTy45kde9yvL");
export const DEX = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
export const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const GUARD_VERSION = "solstock-guard-v1";

export const DEVNET = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEMO_GUARD = new PublicKey("Az4M4V4fFC2ZxNb3SwbSmWWKmXD66HhCFmaduKJDqcA4");
export const DEMO_DEX = new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
export function nativePolicy(policy: Policy) {
  const network = policy.chain.reference;
  if (![MAINNET, DEVNET].includes(network)) throw new Error("Unsupported Solana network");
  const guard = network === DEVNET ? DEMO_GUARD : GUARD, dex = network === DEVNET ? DEMO_DEX : DEX;
  if ([policy.chain, policy.input.chain, policy.output.chain].some((chain) => chain.namespace !== "solana" || chain.reference !== network) ||
      policy.schema !== 1 || !(policy.rule.id === "divergence" || (network === DEVNET && policy.rule.id === "demo-risk")) || (policy.rule.version !== 1 && !(network === DEVNET && policy.rule.id === "demo-risk" && policy.rule.version === 2)) ||
      policy.coverage.inputProfile !== "xstock-scaled-v1" || policy.coverage.outputProfile !== "spl-classic-v1" ||
      policy.guard !== guard.toBase58() || policy.guardVersion !== GUARD_VERSION ||
      policy.coverage.program !== dex.toBase58() || policy.coverage.venue !== "raydium-clmm-v1") {
    throw new Error("Unsupported Solana policy deployment/domain/route");
  }
  for (const key of [policy.owner, policy.keeper, policy.source, policy.recipient, policy.input.address,
    policy.output.address, policy.coverage.pool]) {
    if (new PublicKey(key).toBase58() !== key) throw new Error("Noncanonical native public key");
  }
  if (BigInt(policy.amountRaw) > 0xffffffffffffffffn || BigInt(policy.minimumOutputRaw) > 0xffffffffffffffffn) {
    throw new Error("Amount exceeds native u64");
  }
  return { guard, dex, network };
}
