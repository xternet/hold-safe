import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { type Policy, type UnsignedTransaction } from "../../../../../_kernel/mod";
import { nativePolicy } from "../../_0_identity/mod";
import { authorizeInstruction, executeInstruction, policyAddress, revokeInstruction, stagingAddress, type GuardSwap } from "../../_2_codec/mod";
import { budget, hashMessage, type BlockValidity, type FeeSettings, type SolanaValidity } from "../_shared/mod";
import { decodeEnvelope } from "../_1_envelope/mod";

function build(policy: Policy, digest: string, purpose: UnsignedTransaction["purpose"],
  instructions: TransactionInstruction[], validity: BlockValidity, fees: FeeSettings): UnsignedTransaction {
  nativePolicy(policy);
  const payer = new PublicKey(purpose === "exit" ? policy.keeper : policy.owner);
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: validity.blockhash,
    instructions: [...budget(fees), ...instructions] }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const native: SolanaValidity = { ...validity, purpose, policyDigest: digest, policyAddress: policyAddress(policy).toBase58(),
    feePayer: payer.toBase58(), messageHash: hashMessage(message.serialize()), maxFeeLamports: fees.maxFeeLamports };
  const envelope: UnsignedTransaction = { chain: policy.chain, purpose, bytesBase64: Buffer.from(transaction.serialize()).toString("base64"),
    validity: { adapter: "solana-v1", version: 1, serialized: JSON.stringify(native) } };
  decodeEnvelope(envelope);
  return envelope;
}

export function buildArm(policy: Policy, digest: string, routeKeys: string[], validity: BlockValidity, fees: FeeSettings,
  options: { replaceExistingApproval: boolean; createRecipient: boolean }): UnsignedTransaction {
  const owner = new PublicKey(policy.owner), input = new PublicKey(policy.input.address), output = new PublicKey(policy.output.address);
  const instructions = [createAssociatedTokenAccountIdempotentInstruction(owner, stagingAddress(policy), policyAddress(policy), input, TOKEN_2022_PROGRAM_ID)];
  if (options.createRecipient) {
    const recipient = getAssociatedTokenAddressSync(output, owner, false, TOKEN_PROGRAM_ID);
    if (recipient.toBase58() !== policy.recipient) throw new Error("Only canonical recipient ATA can be created automatically");
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, recipient, owner, output, TOKEN_PROGRAM_ID));
  }
  instructions.push(authorizeInstruction(policy, digest, routeKeys, options.replaceExistingApproval));
  return build(policy, digest, "arm", instructions, validity, fees);
}
export function buildExit(policy: Policy, digest: string, quote: GuardSwap, validity: BlockValidity, fees: FeeSettings): UnsignedTransaction {
  return build(policy, digest, "exit", [executeInstruction(policy, quote)], validity, fees);
}
export function buildRevoke(policy: Policy, digest: string, validity: BlockValidity, fees: FeeSettings): UnsignedTransaction {
  return build(policy, digest, "revoke", [revokeInstruction(policy)], validity, fees);
}
