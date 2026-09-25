import { Buffer } from "buffer";
import { ComputeBudgetInstruction, ComputeBudgetProgram, PublicKey, TransactionMessage } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { copyValue, parseRaw, policyDigest, validatePolicy, type OwnerReview, type UnsignedTransaction } from "../../../../_kernel/mod";
import { GUARD, nativePolicy } from "../../_shared/_0_identity/mod";
import { authorizeInstruction, revokeInstruction } from "../../_shared/_2_codec/_0_instructions/mod";
import { policyAddress, stagingAddress } from "../../_shared/_2_codec/_shared/mod";
import { associatedAllocation } from "../_shared/mod";
import { decodeEnvelope } from "../../_shared/_3_transactions/_1_envelope/mod";

export type { OwnerReview } from "../../../../_kernel/mod";

export async function validateOwnerTransaction(input: UnsignedTransaction, reviewed: OwnerReview) {
  const envelope = copyValue(input), review = copyValue(reviewed), policy = review.policy;
  if (!Number.isSafeInteger(review.nowMs) || review.nowMs <= 0 || policy.owner !== review.owner ||
      !["arm", "revoke"].includes(review.purpose) || envelope.purpose !== review.purpose ||
      typeof review.replaceExistingApproval !== "boolean") throw new Error("Owner transaction differs from reviewed action");
  validatePolicy(policy, review.catalog, review.purpose === "arm" ? Math.floor(review.nowMs / 1000) : 0); nativePolicy(policy);
  const digest = await policyDigest(policy), { transaction, validity } = decodeEnvelope(envelope);
  if (validity.policyDigest !== digest || validity.policyAddress !== policyAddress(policy).toBase58() ||
      validity.feePayer !== review.owner || parseRaw(validity.maxFeeLamports) > parseRaw(review.maximumNetworkFeeRaw) ||
      transaction.signatures.length !== 1 || transaction.signatures[0]!.some(byte => byte !== 0) ||
      Buffer.from(transaction.serialize()).toString("base64") !== envelope.bytesBase64) throw new Error("Unreviewed or signed owner packet");
  const instructions = TransactionMessage.decompile(transaction.message).instructions;
  if (instructions.length < 3 || !instructions[0]!.programId.equals(ComputeBudgetProgram.programId) ||
      !instructions[1]!.programId.equals(ComputeBudgetProgram.programId)) throw new Error("Owner compute budget missing");
  const units = ComputeBudgetInstruction.decodeSetComputeUnitLimit(instructions[0]!).units;
  const price = BigInt(ComputeBudgetInstruction.decodeSetComputeUnitPrice(instructions[1]!).microLamports);
  if (!Number.isSafeInteger(units) || units <= 0 || units > 1400000 || price < 0n ||
      (BigInt(units) * price + 999999n) / 1000000n >= parseRaw(validity.maxFeeLamports)) throw new Error("Unreviewed priority fee");
  const expected = [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price })];
  if (review.purpose === "revoke") expected.push(revokeInstruction(policy));
  else {
    if (instructions.length !== 4 && instructions.length !== 5) throw new Error("Unexpected arm instruction count");
    const owner = new PublicKey(review.owner), inputMint = new PublicKey(policy.input.address);
    expected.push(associatedAllocation(owner, stagingAddress(policy), policyAddress(policy), inputMint, TOKEN_2022_PROGRAM_ID));
    if (instructions.length === 5) {
      const output = new PublicKey(policy.output.address), recipient = getAssociatedTokenAddressSync(output, owner, false, TOKEN_PROGRAM_ID);
      if (recipient.toBase58() !== policy.recipient) throw new Error("Unreviewed recipient allocation");
      expected.push(associatedAllocation(owner, recipient, owner, output, TOKEN_PROGRAM_ID));
    }
    const authorization = instructions[instructions.length - 1]!;
    if (!authorization.programId.equals(GUARD) || authorization.keys.length !== 17) throw new Error("Unexpected authorization instruction");
    expected.push(authorizeInstruction(policy, digest, authorization.keys.slice(6, 16).map(key => key.pubkey.toBase58()), review.replaceExistingApproval));
  }
  const message = new TransactionMessage({ payerKey: new PublicKey(review.owner), recentBlockhash: validity.blockhash, instructions: expected }).compileToV0Message();
  if (!Buffer.from(message.serialize()).equals(Buffer.from(transaction.message.serialize()))) throw new Error("Owner instructions differ from reviewed policy");
  return transaction;
}
