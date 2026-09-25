import { expect, test } from "bun:test";
import { getTransactionDecoder } from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import { policyDigest } from "../../../src/_kernel/mod";
import { buildArm, buildExit, buildRevoke, decodeEnvelope } from "../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { quoteNativeState } from "../../../src/_adapters/_0_solana/_venues/_0_raydium/_0_math/mod";
import { quoteFixture } from "../_shared/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";

test("wallet signs the actual v0 setup; keeper signs only exit; both fit packet limit", async () => {
  const f = quoteFixture(), digest = await policyDigest(f.policy);
  const native = quoteNativeState(f.policy, f.catalog, f.batch);
  const validity = { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1000, contextSlot: f.batch.slot };
  const fees = { computeUnitLimit: 1_000_000, microLamports: "0", baseFeeLamports: "5000", maxFeeLamports: "5000" };
  const arm = buildArm(f.policy, digest, native.routeKeys, validity, fees, { replaceExistingApproval: false, createRecipient: true });
  const setup = decodeEnvelope(arm);
  expect(setup.transaction.message.header.numRequiredSignatures).toBe(1);
  expect(setup.transaction.message.staticAccountKeys[0]!.toBase58()).toBe(f.policy.owner);
  expect(setup.transaction.serialize().length).toBeLessThanOrEqual(1232);
  setup.transaction.sign([f.a.owner]);
  assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(setup.transaction.serialize())));
  const exit = buildExit(f.policy, digest, native, validity, fees);
  const keeper = decodeEnvelope(exit);
  expect(keeper.transaction.message.staticAccountKeys[0]!.toBase58()).toBe(f.policy.keeper);
  expect(keeper.transaction.serialize().length).toBeLessThanOrEqual(1232);
  keeper.transaction.sign([f.a.keeper]);
  assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(keeper.transaction.serialize())));
  expect(f.balances()[2]!.toString()).toBe(native.outputRaw);
});

test("envelope binds network, purpose, message bytes and validity; owner can cancel", async () => {
  const f = quoteFixture(), digest = await policyDigest(f.policy); assertSuccess(f.arm());
  const validity = { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1000, contextSlot: f.batch.slot };
  const fees = { computeUnitLimit: 1_000_000, microLamports: "0", baseFeeLamports: "5000", maxFeeLamports: "5000" };
  const envelope = buildRevoke(f.policy, digest, validity, fees);
  expect(() => decodeEnvelope({ ...envelope, chain: { ...envelope.chain, reference: "other" } })).toThrow();
  expect(() => decodeEnvelope({ ...envelope, purpose: "exit" })).toThrow();
  const modified = VersionedTransaction.deserialize(Buffer.from(envelope.bytesBase64, "base64"));
  modified.message.staticAccountKeys[0] = f.a.delegate.publicKey;
  expect(() => decodeEnvelope({ ...envelope, bytesBase64: Buffer.from(modified.serialize()).toString("base64") })).toThrow();
  const decoded = decodeEnvelope(envelope); decoded.transaction.sign([f.a.owner]);
  assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(decoded.transaction.serialize())));
  expect(f.state()).toBe(3);
  expect(() => buildRevoke(f.policy, digest, validity, { ...fees, microLamports: "1" })).toThrow("fee cap");
});
