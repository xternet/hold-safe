import { AuthorizationReads } from "../../../_1_authorize/_0_read/mod";
import type { ValidatedExit } from "../../_shared/_0_signed/mod";
import { DeliveryError, type DeliveryOptions } from "../_shared/mod";

export async function broadcast(exit: ValidatedExit, options: DeliveryOptions) {
  const now = options.now();
  if (now >= exit.validity.quoteExpiresAtMs! || now >= exit.policy.expiresAt * 1000) throw new DeliveryError("Quote or policy expired before broadcast");
  const authorization = new AuthorizationReads(options.primary.connection, options.catalog, options.manifest, options.log, options.now);
  const current = await authorization.read(exit.policy);
  if (!current.ok || current.value.state !== "active") throw new DeliveryError("Native authorization not active before broadcast");
  await options.fees.check({ chain: exit.signed.chain, purpose: "exit", bytesBase64: exit.signed.bytesBase64, validity: exit.signed.validity });
  if (options.now() >= exit.validity.quoteExpiresAtMs!) throw new DeliveryError("Quote expired during send checks");
  const nativeId = await options.primary.connection.sendRawTransaction(Buffer.from(exit.signed.bytesBase64, "base64"),
    { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0, minContextSlot: exit.validity.contextSlot });
  if (nativeId !== exit.signed.nativeId) throw new DeliveryError("RPC accepted a different transaction ID");
  return { accepted: true };
}
