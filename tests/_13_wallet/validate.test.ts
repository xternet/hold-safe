import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { policyDigest } from "../../src/_kernel/mod";
import { expect, test } from "bun:test";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { validateOwnerTransaction } from "../../src/_adapters/_0_solana/_4_wallet/mod";
import { buildArm, buildRevoke, decodeEnvelope } from "../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { hashMessage } from "../../src/_adapters/_0_solana/_shared/_3_transactions/_shared/mod";
import { authorizationFixture } from "../_8_authorization/_shared/mod";
import type { UnsignedTransaction } from "../../src/_kernel/mod";

function rewrite(envelope: UnsignedTransaction, change: (tx: TransactionMessage) => void): UnsignedTransaction {
  const decoded = decodeEnvelope(envelope), message = TransactionMessage.decompile(decoded.transaction.message);
  change(message);
  const tx = new VersionedTransaction(message.compileToV0Message());
  return { ...envelope, bytesBase64: Buffer.from(tx.serialize()).toString("base64"), validity: { ...envelope.validity,
    serialized: JSON.stringify({ ...decoded.validity, messageHash: hashMessage(tx.message.serialize()) }) } };
}

test("browser validation reconstructs owner arm/revoke and rejects unrelated instructions", async () => {
  const f = await authorizationFixture();
  try {
    const block = { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1150, contextSlot: f.batch.slot };
    const fees = { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000", baseFeeLamports: "5000" };
    const review = { owner: f.policy.owner, policy: f.policy, catalog: f.catalog, purpose: "arm" as const,
      replaceExistingApproval: false, maximumNetworkFeeRaw: "10000", nowMs: f.now() };
    const arm = buildArm(f.policy, f.digest, f.native.routeKeys, block, fees, { replaceExistingApproval: false, createRecipient: false });
    expect((await validateOwnerTransaction(arm, review)).signatures).toHaveLength(1);
    const recipientPolicy = { ...f.policy, recipient: getAssociatedTokenAddressSync(new PublicKey(f.policy.output.address), f.a.owner.publicKey).toBase58() };
    const allocation = buildArm(recipientPolicy, await policyDigest(recipientPolicy), f.native.routeKeys, block, fees,
      { replaceExistingApproval: false, createRecipient: true });
    expect((await validateOwnerTransaction(allocation, { ...review, policy: recipientPolicy })).signatures).toHaveLength(1);
    const extra = rewrite(arm, tx => tx.instructions.push(SystemProgram.transfer({ fromPubkey: f.a.owner.publicKey, toPubkey: f.a.keeper.publicKey, lamports: 1 })));
    await expect(validateOwnerTransaction(extra, review)).rejects.toThrow();
    const altered = rewrite(arm, tx => { const ix = tx.instructions[tx.instructions.length - 1]!; ix.data[ix.data.length - 1] = 1; });
    await expect(validateOwnerTransaction(altered, review)).rejects.toThrow();
    await expect(validateOwnerTransaction(arm, { ...review, owner: f.policy.keeper })).rejects.toThrow();
    await expect(validateOwnerTransaction(arm, { ...review, policy: { ...f.policy, amountRaw: "1" } })).rejects.toThrow();
    const revoke = buildRevoke(f.policy, f.digest, block, fees);
    expect((await validateOwnerTransaction(revoke, { ...review, purpose: "revoke" })).signatures).toHaveLength(1);
    await expect(validateOwnerTransaction(revoke, review)).rejects.toThrow();
    const destination = rewrite(arm, tx => { const ix = tx.instructions[tx.instructions.length - 1]!; ix.keys[5]!.pubkey = f.a.keeper.publicKey; });
    await expect(validateOwnerTransaction(destination, review)).rejects.toThrow();
    const permission = rewrite(arm, tx => { const ix = tx.instructions[tx.instructions.length - 1]!; ix.keys[2]!.isWritable = true; });
    await expect(validateOwnerTransaction(permission, review)).rejects.toThrow();
    const price = rewrite(arm, tx => { tx.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000000n }); });
    await expect(validateOwnerTransaction(price, review)).rejects.toThrow();
    await expect(validateOwnerTransaction(arm, { ...review, maximumNetworkFeeRaw: "5000" })).rejects.toThrow();
    const signed = decodeEnvelope(arm).transaction; signed.sign([f.a.owner]);
    await expect(validateOwnerTransaction({ ...arm, bytesBase64: Buffer.from(signed.serialize()).toString("base64") }, review)).rejects.toThrow();
  } finally { await f.stop(); }
});
