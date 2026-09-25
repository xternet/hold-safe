import type { Connection } from "@solana/web3.js";
import { copyValue, type AuthorizationPort, type Catalog, type Fault, type Outcome } from "../../../_kernel/mod";
import type { GuardManifest } from "../_shared/_5_guard/mod";
import { FeeError, FeeGate, type FeeLimits } from "../_shared/_6_fees/mod";
import type { NativeRouteAccess } from "../_shared/_8_routes/mod";
import { AuthorizationReads } from "./_0_read/mod";
import { AuthorizationError, AuthorizationPreparation } from "./_1_prepare/mod";

export function createAuthorization(connection: Connection, catalog: Catalog, manifest: GuardManifest, limits: FeeLimits,
  route: NativeRouteAccess, log: (fault: Fault) => void, now = Date.now): AuthorizationPort {
  const coverage = copyValue(catalog), reads = new AuthorizationReads(connection, coverage, manifest, log, now);
  const preparation = new AuthorizationPreparation(connection, coverage, reads, new FeeGate(connection, limits), route, now);
  async function attempt<T>(action: string, work: () => Promise<T>): Promise<Outcome<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      const fault: Fault = { code: "UNAVAILABLE", message: error instanceof AuthorizationError || error instanceof FeeError ? error.message : "Native authorization action unavailable; invalid or inaccessible state",
        retryable: true, context: { adapter: "solana-authorization", action, receivedAtMs: String(now()) } };
      log(fault); return { ok: false, error: fault };
    }
  }
  return { read: policy => reads.read(copyValue(policy)), preview: policy => attempt("preview", () => preparation.preview(copyValue(policy))),
    prepareArm: (policy, digest, options) => attempt("arm", () => preparation.arm(copyValue(policy), digest, copyValue(options))),
    prepareRevoke: policy => attempt("revoke", () => preparation.revoke(copyValue(policy))) };
}
