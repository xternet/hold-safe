import { ComputeBudgetInstruction, ComputeBudgetProgram, PublicKey, TransactionMessage } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import { copyValue, policyDigest, validatePolicy, type Catalog, type Policy, type SignedAttempt } from "../../../../../_kernel/mod";
import { GUARD, nativePolicy } from "../../../_shared/mod";
import { executeInstruction, policyAddress } from "../../../_shared/_2_codec/mod";
import { discriminator } from "../../../_shared/_2_codec/_shared/mod";
import { decodeEnvelope } from "../../../_shared/_3_transactions/mod";

export async function validateSignedExit(input: SignedAttempt, document: Policy, catalog: Catalog, keeper: string) {
  const signed = copyValue(input), policy = copyValue(document);
  validatePolicy(policy, catalog, 0); nativePolicy(policy);
  const digest = await policyDigest(policy);
  const { transaction, validity } = decodeEnvelope({ ...signed, purpose: "exit" });
  if (signed.policyDigest !== digest || validity.policyDigest !== digest || validity.policyAddress !== policyAddress(policy).toBase58() ||
    validity.feePayer !== policy.keeper || policy.keeper !== keeper || transaction.signatures.length !== 1 ||
    Buffer.from(transaction.serialize()).toString("base64") !== signed.bytesBase64) throw new Error("Signed exit policy/encoding differs");
  if (!Number.isSafeInteger(validity.quoteExpiresAtMs) || validity.quoteExpiresAtMs! <= 0) throw new Error("Missing quote expiry for signed exit");
  const signature = transaction.signatures[0]!;
  if (getBase58Decoder().decode(signature) !== signed.nativeId) throw new Error("Signed exit native ID differs");
  const key = await crypto.subtle.importKey("raw", new Uint8Array(new PublicKey(keeper).toBytes()), "Ed25519", false, ["verify"]);
  if (!await crypto.subtle.verify("Ed25519", key, new Uint8Array(signature), new Uint8Array(transaction.message.serialize()))) throw new Error("Invalid keeper signature");
  const decoded = TransactionMessage.decompile(transaction.message), instructions = decoded.instructions;
  if (instructions.length !== 3 || !instructions[0]!.programId.equals(ComputeBudgetProgram.programId) ||
    !instructions[1]!.programId.equals(ComputeBudgetProgram.programId)) throw new Error("Exit must contain only budgets and guarded swap");
  const limit = ComputeBudgetInstruction.decodeSetComputeUnitLimit(instructions[0]!).units;
  const price = BigInt(ComputeBudgetInstruction.decodeSetComputeUnitPrice(instructions[1]!).microLamports);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1400000 || price < 0n ||
    (BigInt(limit) * price + 999999n) / 1000000n >= BigInt(validity.maxFeeLamports)) throw new Error("Invalid exit compute budget");
  const exit = instructions[2]!;
  if (!exit.programId.equals(GUARD) || exit.data.length !== 16 || !exit.data.subarray(0, 8).equals(discriminator("global", "execute")) ||
    exit.keys.length < 18 || exit.keys.length > 23) throw new Error("Invalid guard exit instruction");
  const minimumOutputRaw = exit.data.readBigUInt64LE(8).toString();
  const route = exit.keys.slice(5, 15).map(meta => meta.pubkey.toBase58());
  const expected = executeInstruction(policy, { inputRaw: policy.amountRaw, outputRaw: minimumOutputRaw, minimumOutputRaw,
    routeKeys: route, ticks: exit.keys.slice(16).map(meta => meta.pubkey.toBase58()) });
  const canonical = new TransactionMessage({ payerKey: new PublicKey(keeper), recentBlockhash: validity.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: limit }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), expected] }).compileToV0Message();
  if (!Buffer.from(canonical.serialize()).equals(Buffer.from(transaction.message.serialize()))) throw new Error("Recovered exit instruction permissions differ");
  return { signed, policy, transaction, validity, minimumOutputRaw, route };
}
export type ValidatedExit = Awaited<ReturnType<typeof validateSignedExit>>;
