import { copyValue } from "../../../../_kernel/mod";
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { assetKey, validatePolicy, type AssetRef, type Catalog, type HoldingObservation, type Policy } from "../../../../_kernel/mod";
import { nativeMint, nativePolicy, nativeToken } from "../../_shared/mod";
import { binaryMultiplier } from "./_0_multiplier/mod";
import { corporateActionGate } from "../../_shared/_11_corporate/mod";
import { holdingClock } from "./_shared/mod";

export function decodeHolding(policy: Policy, catalog: Catalog, accounts: Map<string, AccountInfo<Buffer>>, slot: number, receivedAtMs: number): HoldingObservation {
  validatePolicy(policy, catalog, Math.floor(receivedAtMs / 1000)); nativePolicy(policy);
  return decodeAccountHolding(policy.input, policy.owner, policy.source, catalog, accounts, slot, receivedAtMs, policy.rule.maxAgeMs);
}
export function decodeAccountHolding(asset: AssetRef, owner: string, source: string, catalog: Catalog,
  accounts: Map<string, AccountInfo<Buffer>>, slot: number, receivedAtMs: number, maxAgeMs = 5000): HoldingObservation {
  const get = (key: string) => {
    const value = accounts.get(key);
    if (value === undefined || value.executable) throw new Error("Missing/executable holding account");
    return value;
  };
  const { seconds, sourceAtMs } = holdingClock(accounts, slot, receivedAtMs, maxAgeMs);
  const spec = catalog.assets.find((item) => assetKey(item.ref) === assetKey(asset));
  if (spec === undefined) throw new Error("Missing holding catalog asset");
  const mintKey = new PublicKey(asset.address), mintAccount = get(asset.address), sourceAccount = get(source);
  const { scaled, program } = nativeMint(mintKey, mintAccount, spec.profile, spec.decimals);
  if (scaled === null) throw new Error("Missing scaled holding multiplier");
  corporateActionGate(scaled, seconds);
  const token = nativeToken(new PublicKey(source), sourceAccount, program, mintKey, new PublicKey(owner));
  const multiplier = binaryMultiplier(seconds >= scaled.newMultiplierEffectiveTimestamp ? scaled.newMultiplier : scaled.multiplier);
  const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  return { id: crypto.randomUUID(), asset: copyValue(asset), account: source, owner: owner,
    balanceRaw: token.amount.toString(), delegate: token.delegate === null ? null : token.delegate.toBase58(),
    allowanceRaw: token.delegatedAmount.toString(), frozen: false, paused: false, multiplier, sourceAtMs, receivedAtMs,
    context: { adapter: "solana-mainnet", version: 1, serialized: JSON.stringify({ slot,
      mintHash: hash(mintAccount.data), sourceHash: hash(sourceAccount.data), multiplierEffectiveAt: scaled.newMultiplierEffectiveTimestamp.toString() }) } };
}
