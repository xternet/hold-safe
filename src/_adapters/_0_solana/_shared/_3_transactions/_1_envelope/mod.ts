import { Buffer } from "buffer";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { UnsignedTransaction } from "../../../../../_kernel/mod";
import { MAINNET } from "../../_0_identity/mod";
import { hashMessage, type SolanaValidity } from "../_shared/mod";

export function decodeEnvelope(envelope: UnsignedTransaction): { transaction: VersionedTransaction; validity: SolanaValidity } {
  if (envelope.chain.namespace !== "solana" || envelope.chain.reference !== MAINNET ||
      envelope.validity.adapter !== "solana-v1" || envelope.validity.version !== 1) throw new Error("Wrong transaction domain/schema");
  const validity: SolanaValidity = JSON.parse(envelope.validity.serialized);
  if (!["arm", "revoke", "exit"].includes(validity.purpose) || validity.purpose !== envelope.purpose ||
      !Number.isSafeInteger(validity.lastValidBlockHeight) || validity.lastValidBlockHeight <= 0 ||
      !Number.isSafeInteger(validity.contextSlot) || validity.contextSlot <= 0 ||
      !/^[a-f0-9]{64}$/.test(validity.policyDigest) || !/^[a-f0-9]{64}$/.test(validity.messageHash) ||
      !/^[1-9][0-9]*$/.test(validity.maxFeeLamports)) throw new Error("Invalid transaction validity metadata");
  for (const key of [validity.blockhash, validity.feePayer, validity.policyAddress]) {
    if (new PublicKey(key).toBase58() !== key) throw new Error("Invalid validity address");
  }
  const bytes = Buffer.from(envelope.bytesBase64, "base64");
  if (bytes.length > 1232 || bytes.toString("base64") !== envelope.bytesBase64) throw new Error("Invalid transaction encoding/size");
  const transaction = VersionedTransaction.deserialize(bytes), message = transaction.message;
  if (message.version !== 0 || message.header.numRequiredSignatures !== 1 || message.addressTableLookups.length !== 0 ||
      message.recentBlockhash !== validity.blockhash || message.staticAccountKeys[0]!.toBase58() !== validity.feePayer ||
      hashMessage(message.serialize()) !== validity.messageHash) throw new Error("Transaction/validity binding mismatch");
  return { transaction, validity };
}
