import { type TokenBalance } from "@solana/web3.js";
import { assetKey, parseRaw } from "../../../../../_kernel/mod";
import { policyAddress, stagingAddress } from "../../../_shared/_2_codec/mod";
import type { ValidatedExit } from "../../_shared/_0_signed/mod";
import { DeliveryError, type DeliveryOptions, type RpcSource } from "../_shared/mod";
import type { Probe } from "../_2_probe/mod";

export async function finalReceipt(source: RpcSource, exit: ValidatedExit, view: Probe, options: DeliveryOptions) {
  const tx = await source.connection.getTransaction(exit.signed.nativeId, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (tx === null || tx.meta === null || tx.version !== 0 || tx.slot !== view.status!.slot || tx.slot > view.slot ||
    tx.transaction.signatures.length !== 1 || tx.transaction.signatures[0] !== exit.signed.nativeId ||
    !Buffer.from(tx.transaction.message.serialize()).equals(Buffer.from(exit.transaction.message.serialize()))) throw new DeliveryError("Finalized transaction missing or differs from signed attempt");
  const meta = tx.meta, fee = meta.fee;
  if (!Number.isSafeInteger(fee) || fee <= 0 || BigInt(fee) > BigInt(exit.validity.maxFeeLamports) ||
    JSON.stringify(meta.err) !== JSON.stringify(view.status!.err)) throw new DeliveryError("Finalized fee or execution status differs");
  const keys = exit.transaction.message.staticAccountKeys;
  if (meta.preBalances.length !== keys.length || meta.postBalances.length !== keys.length ||
    !meta.preBalances.every(Number.isSafeInteger) || !meta.postBalances.every(Number.isSafeInteger) ||
    meta.preBalances[0]! - meta.postBalances[0]! !== fee) throw new DeliveryError("Invalid finalized payer delta");
  if (meta.err !== null) {
    if (view.native.state === "consumed") throw new DeliveryError("Failed receipt conflicts with consumed policy");
    return { state: "failed" as const, slot: tx.slot, feeRaw: String(fee), error: JSON.stringify(meta.err) };
  }
  if (view.native.state !== "consumed") throw new DeliveryError("Successful transaction lacks consumed native policy");
  const decimals = (side: "input" | "output") => {
    const asset = options.catalog.assets.find(asset => assetKey(asset.ref) === assetKey(exit.policy[side]));
    if (asset === undefined) throw new DeliveryError("Missing receipt accounting profile"); return asset.decimals;
  };
  const amount = (balances: TokenBalance[] | null | undefined, key: string, mint: string, owner: string, decimal: number) => {
    if (balances === null || balances === undefined) throw new DeliveryError("Missing finalized token balances");
    const index = keys.findIndex(pubkey => pubkey.toBase58() === key), rows = balances.filter(row => row.accountIndex === index);
    if (index < 0 || rows.length !== 1 || rows[0]!.mint !== mint || rows[0]!.owner !== owner || rows[0]!.uiTokenAmount.decimals !== decimal) throw new DeliveryError("Finalized token identity differs");
    return parseRaw(rows[0]!.uiTokenAmount.amount, true);
  };
  const delta = (key: string, side: "input" | "output", owner: string) => amount(meta.postTokenBalances, key, exit.policy[side].address, owner, decimals(side)) - amount(meta.preTokenBalances, key, exit.policy[side].address, owner, decimals(side));
  const input = -delta(exit.policy.source, "input", exit.policy.owner), output = delta(exit.policy.recipient, "output", exit.policy.owner);
  if (input !== parseRaw(exit.policy.amountRaw) || output < parseRaw(exit.minimumOutputRaw) ||
    delta(stagingAddress(exit.policy).toBase58(), "input", policyAddress(exit.policy).toBase58()) !== 0n) throw new DeliveryError("Finalized exit deltas violate signed bounds");
  return { state: "confirmed" as const, slot: tx.slot, feeRaw: String(fee), error: null, inputRaw: input.toString(), outputRaw: output.toString() };
}
