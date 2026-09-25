import type { Receipt } from "../../../../../_kernel/mod";
import type { ValidatedExit } from "../../_shared/_0_signed/mod";
import { DeliveryError, receipt, type DeliveryOptions } from "../_shared/mod";
import { probe } from "../_2_probe/mod";
import { finalReceipt } from "../_3_receipt/mod";

export async function reconcile(exit: ValidatedExit, options: DeliveryOptions): Promise<Receipt> {
  const sources = [options.primary, options.backup];
  const results = await Promise.allSettled(sources.map(async source => {
    const view = await probe(source, exit, options);
    const proof = view.status?.confirmationStatus === "finalized" ? await finalReceipt(source, exit, view, options) : null;
    return { view, proof };
  }));
  const failures = results.flatMap((result, index) => result.status === "fulfilled" ? [] : [{
    provider: sources[index]!.id, reason: result.reason instanceof DeliveryError ? result.reason.message : "RPC evidence unavailable; details redacted",
  }]);
  const unknown = (reason: string) => {
    options.log({ code: "UNAVAILABLE", message: reason, retryable: true,
      context: { adapter: "solana-receipt", nativeId: exit.signed.nativeId, policyDigest: exit.signed.policyDigest, failures: JSON.stringify(failures) } });
    return receipt(exit.signed.nativeId, "unknown", options.now(), { reason, providers: sources.map(source => source.id), failures });
  };
  if (results.some(result => result.status === "rejected")) return unknown("One or more receipt providers unavailable or inconsistent");
  const evidence = results.map(result => { if (result.status !== "fulfilled") throw new Error("Receipt result invariant"); return result.value; });
  const a = evidence[0]!, b = evidence[1]!;
  if (Math.abs(a.view.slot - b.view.slot) > 64 || a.view.native.state !== b.view.native.state) return unknown("Finalized provider views disagree");
  const providers = evidence.map(({ view }) => ({ id: view.source, slot: view.slot, sourceAtMs: view.sourceAtMs, height: view.height, validHash: view.validHash, policyState: view.native.state }));
  if (a.proof !== null || b.proof !== null) {
    if (a.proof === null || b.proof === null || JSON.stringify(a.proof) !== JSON.stringify(b.proof)) return unknown("Finalized receipts disagree or are incomplete");
    return receipt(exit.signed.nativeId, a.proof.state, options.now(), { proof: a.proof, providers });
  }
  if (evidence.every(({ view }) => view.status === null)) {
    if (a.view.native.state === "consumed") return unknown("Policy consumed without the recorded signature receipt");
    if (evidence.every(({ view }) => view.height > exit.validity.lastValidBlockHeight && !view.validHash)) {
      return receipt(exit.signed.nativeId, "expired", options.now(), { reason: "Finalized blockhash expired and policy unconsumed", providers });
    }
    if (evidence.some(({ view }) => view.height > exit.validity.lastValidBlockHeight || !view.validHash)) return unknown("Blockhash expiry evidence incomplete");
  } else if (evidence.some(({ view }) => view.status === null)) return unknown("Providers disagree about signature visibility");
  return receipt(exit.signed.nativeId, "pending", options.now(), { reason: "No agreed finalized receipt yet", providers });
}
