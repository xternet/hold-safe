import { PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo, type Connection } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { assetKey, copyValue, validateCatalog, type Catalog, type Fault, type WalletInventory, type WalletInventoryPort } from "../../../_kernel/mod";
import { MAINNET, nativeMint } from "../_shared/mod";
import { createWalletIdentity } from "../_5_identity/mod";
import { decodeAccountHolding } from "../_0_reader/_0_decode/mod";
import { holdingClock } from "../_0_reader/_0_decode/_shared/mod";

class InventoryError extends Error {}

export function createWalletInventory(connection: Connection, input: Catalog, log: (fault: Fault) => void, now = Date.now): WalletInventoryPort {
  const catalog = validateCatalog(copyValue(input)), identity = createWalletIdentity();
  let lastSlot = 0;
  return { async list(owner, routeId) {
    let phase = "request";
    try {
      const route = catalog.routes.find(item => item.id === routeId);
      if (!identity.validOwner(owner) || route === undefined || route.chain.namespace !== "solana" || route.chain.reference !== MAINNET) throw new InventoryError("Unsupported wallet or route");
      const inputSpec = catalog.assets.find(asset => assetKey(asset.ref) === assetKey(route.input));
      const outputSpec = catalog.assets.find(asset => assetKey(asset.ref) === assetKey(route.output));
      if (inputSpec === undefined || outputSpec === undefined) throw new InventoryError("Missing catalog accounting");
      phase = "genesis";
      if (await connection.getGenesisHash() !== MAINNET) throw new InventoryError("RPC mainnet identity mismatch");
      phase = "discovery";
      const discovered = await connection.getTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(route.input.address) }, "confirmed");
      if (!Number.isSafeInteger(discovered.context.slot) || discovered.context.slot < lastSlot) throw new InventoryError("Regressed discovery context");
      if (discovered.value.length > 97) throw new InventoryError("Wallet exceeds supported 97 input accounts; no partial inventory returned");
      const sources = discovered.value.map(item => item.pubkey.toBase58());
      if (new Set(sources).size !== sources.length) throw new InventoryError("Duplicate discovered token accounts");
      const keys = [new PublicKey(route.input.address), new PublicKey(route.output.address), SYSVAR_CLOCK_PUBKEY, ...sources.map(key => new PublicKey(key))];
      phase = "batch";
      const batch = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: "confirmed", minContextSlot: Math.max(lastSlot, discovered.context.slot) });
      if (batch.context.slot < discovered.context.slot || batch.context.slot < lastSlot || batch.value.length !== keys.length) throw new InventoryError("Regressed or incomplete inventory batch");
      const receivedAtMs = now(), accounts = new Map<string, AccountInfo<Buffer>>();
      batch.value.forEach((value, index) => { if (value !== null) accounts.set(keys[index]!.toBase58(), value); });
      phase = "metadata";
      holdingClock(accounts, batch.context.slot, receivedAtMs, 5000);
      const inMint = accounts.get(route.input.address), outMint = accounts.get(route.output.address);
      if (inMint === undefined || outMint === undefined || inMint.executable || outMint.executable) throw new InventoryError("Missing inventory mint");
      nativeMint(keys[0]!, inMint, inputSpec.profile, inputSpec.decimals);
      const output = nativeMint(keys[1]!, outMint, outputSpec.profile, outputSpec.decimals);
      const recipient = getAssociatedTokenAddressSync(keys[1]!, new PublicKey(owner), false, output.program).toBase58();
      const result: WalletInventory = { owner, routeId, recipient, receivedAtMs, holdings: [], excluded: [] };
      for (const source of sources) {
        try {
          const holding = decodeAccountHolding(route.input, owner, source, catalog, accounts, batch.context.slot, receivedAtMs);
          result.holdings.push({ account: source, balanceRaw: holding.balanceRaw, delegate: holding.delegate, allowanceRaw: holding.allowanceRaw,
            multiplier: { n: holding.multiplier.n.toString(), d: holding.multiplier.d.toString() }, sourceAtMs: holding.sourceAtMs });
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : "Invalid native token account";
          result.excluded.push({ account: source, reason });
          log({ code: "INVALID", message: reason, retryable: false, context: { component: "wallet-inventory", account: source } });
        }
      }
      lastSlot = Math.max(lastSlot, batch.context.slot); return { ok: true, value: result };
    } catch (cause) {
      const message = (cause instanceof InventoryError || phase === "metadata") && cause instanceof Error ?
        `Inventory unavailable: ${cause.message}` : "Wallet inventory unavailable; RPC details redacted";
      const error: Fault = { code: "UNAVAILABLE", message, retryable: phase !== "request", context: { component: "wallet-inventory", phase } };
      log(error); return { ok: false, error };
    }
  } };
}
