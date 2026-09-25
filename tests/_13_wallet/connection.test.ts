import { expect, test } from "bun:test";
import { createPrivateKey, sign } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { getTransactionDecoder } from "@solana/kit";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { connectWallet, supportedWallet } from "../../src/_adapters/_0_solana/_4_wallet/mod";
import { buildArm, buildRevoke } from "../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { authorizationFixture } from "../_8_authorization/_shared/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";
import type { WalletPort } from "../../src/_kernel/mod";

test("wallet-standard connection signs actual messages and submits actual reviewed arm/revoke", async () => {
  const f = await authorizationFixture();
  const account: WalletAccount = { address: f.policy.owner, publicKey: f.a.owner.publicKey.toBytes(), chains: ["solana:mainnet"],
    features: ["solana:signMessage", "solana:signAndSendTransaction"] };
  let accounts: readonly WalletAccount[] = [], sends = 0, changeMessage = false;
  // Explicit local test wallet; all signatures and native transactions are real.
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(f.a.owner.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  const wallet: Wallet = { version: "1.0.0", name: "Local test wallet", icon: "data:image/svg+xml;base64,PHN2Zy8+", chains: ["solana:mainnet"],
    get accounts() { return accounts; }, features: {
      "standard:connect": { version: "1.0.0", connect: async () => { accounts = [account]; return { accounts }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { accounts = []; } },
      "standard:events": { version: "1.0.0", on: () => () => undefined },
      "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: { message: Uint8Array }[]) => inputs.map(input => {
        const message = changeMessage ? new TextEncoder().encode("altered message") : input.message;
        return { signedMessage: message, signature: sign(null, message, privateKey) };
      }) },
      "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: [0],
        signAndSendTransaction: async (...inputs: { transaction: Uint8Array; chain: string; options: { skipPreflight: boolean } }[]) => inputs.map(input => {
          expect(input.chain).toBe("solana:mainnet"); expect(input.options.skipPreflight).toBe(false);
          const transaction = VersionedTransaction.deserialize(input.transaction); transaction.sign([f.a.owner]);
          assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize()))); sends++;
          return { signature: transaction.signatures[0]! };
        }) },
    } };
  try {
    expect(supportedWallet(wallet)).toBe(true);
    expect(supportedWallet({ ...wallet, chains: ["solana:devnet"] })).toBe(false);
    expect(supportedWallet({ ...wallet, features: {} })).toBe(false);
    const connected: WalletPort = await connectWallet(wallet); expect(connected.owner).toBe(f.policy.owner);
    expect(connected.chain).toEqual(f.policy.chain);
    const signature = await connected.signMessage("Actual local wallet sign-in proof");
    expect(Buffer.from(signature, "base64")).toHaveLength(64);
    changeMessage = true; await expect(connected.signMessage("Exact challenge")).rejects.toThrow("changed"); changeMessage = false;
    const block = { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1150, contextSlot: f.batch.slot };
    const fees = { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000", baseFeeLamports: "5000" };
    const review = { owner: f.policy.owner, policy: f.policy, catalog: f.catalog, purpose: "arm" as const,
      replaceExistingApproval: false, maximumNetworkFeeRaw: "10000", nowMs: f.now() };
    const arm = buildArm(f.policy, f.digest, f.native.routeKeys, block, fees, { replaceExistingApproval: false, createRecipient: false });
    await expect(connected.send(arm, { ...review, owner: f.policy.keeper })).rejects.toThrow();
    expect(sends).toBe(0);
    expect(await connected.send(arm, review)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/); expect(f.state()).toBe(1);
    const revoke = buildRevoke(f.policy, f.digest, block, fees);
    await connected.send(revoke, { ...review, purpose: "revoke" }); expect(f.state()).toBe(3); expect(sends).toBe(2);
    await connected.disconnect(); await expect(connected.signMessage("After disconnect")).rejects.toThrow("disconnected");
  } finally { await f.stop(); }
});
