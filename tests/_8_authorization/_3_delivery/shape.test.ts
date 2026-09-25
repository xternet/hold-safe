import { expect, test } from "bun:test";
import { getBase58Decoder } from "@solana/kit";
import { SystemProgram, TransactionMessage } from "@solana/web3.js";
import { copyValue, type SignedAttempt } from "../../../src/_kernel/mod";
import { buildExit, decodeEnvelope } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { hashMessage } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/_shared/mod";
import { validateSignedExit } from "../../../src/_adapters/_0_solana/_2_execution/_shared/_0_signed/mod";
import { authorizationFixture } from "../_shared/mod";

async function fixture() {
  const f = await authorizationFixture(); f.armBound();
  const envelope = buildExit(f.policy, f.digest, f.native,
    { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1150, contextSlot: f.batch.slot },
    { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000", baseFeeLamports: "5000" });
  envelope.validity.serialized = JSON.stringify({ ...JSON.parse(envelope.validity.serialized), quoteExpiresAtMs: f.now() + 2000 });
  const { transaction } = decodeEnvelope(envelope); transaction.sign([f.a.keeper]);
  const signed: SignedAttempt = { chain: f.policy.chain, policyDigest: f.digest, bytesBase64: Buffer.from(transaction.serialize()).toString("base64"),
    nativeId: getBase58Decoder().decode(transaction.signatures[0]!), validity: envelope.validity };
  return { ...f, signed, transaction };
}
test("recovered signed exit verifies signature, canonical bytes and exact bounded instruction shape", async () => {
  const f = await fixture();
  try {
    const checked = await validateSignedExit(f.signed, f.policy, f.catalog, f.policy.keeper);
    expect(checked.minimumOutputRaw).toBe(f.native.minimumOutputRaw);
    expect(checked.route).toEqual(f.native.routeKeys);
    expect(Buffer.from(checked.transaction.serialize()).toString("base64")).toBe(f.signed.bytesBase64);
    const mutations = [
      (s: SignedAttempt) => { s.nativeId = getBase58Decoder().decode(new Uint8Array(64)); },
      (s: SignedAttempt) => { s.chain.reference = "foreign"; },
      (s: SignedAttempt) => { const validity = JSON.parse(s.validity.serialized); delete validity.quoteExpiresAtMs; s.validity.serialized = JSON.stringify(validity); },
      (s: SignedAttempt) => { s.policyDigest = "00".repeat(32); },
      (s: SignedAttempt) => { const bytes = Buffer.from(s.bytesBase64, "base64"); bytes[1] = bytes[1]! ^ 1; s.bytesBase64 = bytes.toString("base64"); s.nativeId = getBase58Decoder().decode(bytes.subarray(1, 65)); },
      (s: SignedAttempt) => { s.bytesBase64 = Buffer.concat([Buffer.from(s.bytesBase64, "base64"), Buffer.from([0])]).toString("base64"); },
    ];
    for (const change of mutations) {
      const altered = copyValue(f.signed); change(altered);
      await expect(validateSignedExit(altered, f.policy, f.catalog, f.policy.keeper)).rejects.toThrow();
    }
    await expect(validateSignedExit(f.signed, f.policy, f.catalog, f.policy.owner)).rejects.toThrow();
  } finally { await f.stop(); }
});
test("even a valid keeper signature cannot turn delivery into an arbitrary transfer relay", async () => {
  for (const mode of ["extra-transfer", "floor", "recipient", "purpose"]) {
    const f = await fixture();
    try {
      const message = TransactionMessage.decompile(f.transaction.message);
      if (mode === "extra-transfer") message.instructions.push(SystemProgram.transfer({ fromPubkey: f.a.keeper.publicKey, toPubkey: f.a.owner.publicKey, lamports: 1 }));
      if (mode === "floor") message.instructions[2]!.data.writeBigUInt64LE(0n, 8);
      if (mode === "recipient") message.instructions[2]!.keys[4]!.pubkey = f.a.owner.publicKey;
      f.transaction.message = message.compileToV0Message(); f.transaction.sign([f.a.keeper]);
      const metadata = JSON.parse(f.signed.validity.serialized);
      metadata.messageHash = hashMessage(f.transaction.message.serialize());
      if (mode === "purpose") metadata.purpose = "arm";
      f.signed.validity.serialized = JSON.stringify(metadata);
      f.signed.bytesBase64 = Buffer.from(f.transaction.serialize()).toString("base64");
      f.signed.nativeId = getBase58Decoder().decode(f.transaction.signatures[0]!);
      await expect(validateSignedExit(f.signed, f.policy, f.catalog, f.policy.keeper)).rejects.toThrow();
    } finally { await f.stop(); }
  }
});
