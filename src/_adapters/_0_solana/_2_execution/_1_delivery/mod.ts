import { copyValue, validateCatalog, type Outcome, type Receipt, type SignedAttempt } from "../../../../_kernel/mod";
import { validateSignedExit } from "../_shared/_0_signed/mod";
import { broadcast } from "./_0_send/mod";
import { reconcile } from "./_1_reconcile/mod";
import { DeliveryError, type DeliveryOptions } from "./_shared/mod";

export class NativeDelivery {
  private readonly options: DeliveryOptions;
  constructor(options: DeliveryOptions) {
    if (options.primary.id === options.backup.id || new URL(options.primary.connection.rpcEndpoint).origin === new URL(options.backup.connection.rpcEndpoint).origin) throw new Error("Delivery requires two distinct RPC providers");
    this.options = { ...options, primary: { ...options.primary }, backup: { ...options.backup }, catalog: validateCatalog(copyValue(options.catalog)), manifest: copyValue(options.manifest) };
  }
  broadcast(input: SignedAttempt): Promise<Outcome<{ accepted: boolean }>> { return this.run("broadcast", input, exit => broadcast(exit, this.options)); }
  reconcile(input: SignedAttempt): Promise<Outcome<Receipt>> { return this.run("reconcile", input, exit => reconcile(exit, this.options)); }
  private async run<T>(action: string, input: SignedAttempt, work: (exit: Awaited<ReturnType<typeof validateSignedExit>>) => Promise<T>): Promise<Outcome<T>> {
    const signed = copyValue(input);
    try {
      const policy = await this.options.policy(signed.policyDigest);
      const exit = await validateSignedExit(signed, policy, this.options.catalog, this.options.keeper);
      return { ok: true, value: await work(exit) };
    } catch (error) {
      const fault = { code: "UNAVAILABLE" as const, message: error instanceof DeliveryError ? error.message : "Native delivery unavailable; details redacted", retryable: true,
        context: { adapter: "solana-delivery", action, policyDigest: signed.policyDigest, nativeId: signed.nativeId } };
      this.options.log(fault); return { ok: false, error: fault };
    }
  }
}
