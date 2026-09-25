import { validateCatalog, type Catalog, type Fault, type Policy } from "../../_kernel/mod";
import { createWalletIdentity } from "./_5_identity/mod";
import { createWalletInventory } from "./_6_inventory/mod";
import { createSolanaReader } from "./_0_reader/mod";
import { createAuthorization } from "./_1_authorize/mod";
import { createExecution } from "./_2_execution/mod";
import { createRaydiumVenue } from "./_venues/_0_raydium/mod";
import { GUARD, MAINNET } from "./_shared/_0_identity/mod";
import { readConnection } from "./_shared/_4_rpc/mod";
import { FeeGate, type FeeLimits } from "./_shared/_6_fees/mod";
import { loadRelease } from "./_shared/_9_release/mod";
import { verifyStartup } from "./_shared/_10_startup/mod";

export interface SolanaOptions {
  primary: string; backup: string; websocket: string; keeperFile: string; guardManifest: string;
  catalog: Catalog; fees: FeeLimits; policy(digest: string): Promise<Policy>;
  log(fault: Fault): void; now(): number;
}
export async function createSolana(options: SolanaOptions) {
  let phase = "catalog";
  try {
    const catalog = validateCatalog(options.catalog);
    if (catalog.chains.length !== 1 || catalog.chains[0]!.id !== "solana-v1" ||
        catalog.chains[0]!.chain.namespace !== "solana" || catalog.chains[0]!.chain.reference !== MAINNET) throw new Error("Unsupported chain registry");
    phase = "release";
    const release = await loadRelease(options.keeperFile, options.guardManifest);
    const keeper = release.keeper.publicKey.toBase58();
    phase = "providers";
    const primary = { id: "primary", connection: readConnection(options.primary, "primary", options.log) };
    const backup = { id: "backup", connection: readConnection(options.backup, "backup", options.log) };
    await verifyStartup(primary.connection, backup.connection, release.deployment);
    phase = "composition";
    const route = createRaydiumVenue(primary.connection, catalog, options.log, options.now);
    const chain = createSolanaReader(primary.connection, options.websocket, catalog, options.log, options.now);
    const authorization = createAuthorization(primary.connection, catalog, release.manifest, options.fees, route, options.log, options.now);
    const fees = new FeeGate(primary.connection, options.fees);
    const execution = createExecution({ primary, backup, catalog, manifest: release.manifest, keeper,
      policy: options.policy, fees, log: options.log, now: options.now }, { keeper: release.keeper, authorization, holdings: chain, route });
    return { chain, authorization, execution, identity: createWalletIdentity(),
      inventory: createWalletInventory(primary.connection, catalog, options.log, options.now), venue: route.venue, keeper, guard: GUARD.toBase58() };
  } catch {
    options.log({ code: "UNAVAILABLE", message: "Solana startup failed; provider and key details redacted", retryable: true,
      context: { component: "solana-startup", phase } });
    throw new Error("Solana startup failed");
  }
}
