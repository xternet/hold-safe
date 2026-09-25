import type { Page } from "@playwright/test";
import { createPrivateKey, sign } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { getTransactionDecoder } from "@solana/kit";
import type { workflowFixture } from "../../_11_policy_workflow/_shared/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";

// Test-only Wallet Standard provider. Signs actual messages and submits to the
// isolated SVM; no production key or success response is fabricated.
export async function installWallet(page: Page, f: Pick<Awaited<ReturnType<typeof workflowFixture>>, "a" | "policy" | "svm">) {
  let rejectNext = false;
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(f.a.owner.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
  await page.exposeFunction("fixtureSign", (bytes: number[]) => Array.from(sign(null, Buffer.from(bytes), key)));
  await page.exposeFunction("fixtureSend", (bytes: number[]) => {
    if (rejectNext) { rejectNext = false; throw new Error("User rejected the local test wallet prompt"); }
    const transaction = VersionedTransaction.deserialize(Uint8Array.from(bytes)); transaction.sign([f.a.owner]);
    assertSuccess(f.svm.sendTransaction(getTransactionDecoder().decode(transaction.serialize())));
    return Array.from(transaction.signatures[0]!);
  });
  await page.addInitScript(({ owner, publicKey }) => {
    const account = { address: owner, publicKey: Uint8Array.from(publicKey), chains: ["solana:mainnet"],
      features: ["solana:signMessage", "solana:signAndSendTransaction"] };
    let accounts: typeof account[] = [];
    const listeners = new Set<(event: { accounts: typeof accounts }) => void>();
    const bridge = window as unknown as { fixtureSign(bytes: number[]): Promise<number[]>; fixtureSend(bytes: number[]): Promise<number[]> };
    const wallet = { version: "1.0.0", name: "Local SVM wallet", icon: "data:image/svg+xml;base64,PHN2Zy8+", chains: ["solana:mainnet"],
      get accounts() { return accounts; }, features: {
        "standard:connect": { version: "1.0.0", connect: async () => { accounts = [account]; return { accounts }; } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => { accounts = []; } },
        "standard:events": { version: "1.0.0", on: (_event: string, listener: (event: { accounts: typeof accounts }) => void) => {
          listeners.add(listener); return () => { listeners.delete(listener); };
        } },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async input => ({
          signedMessage: input.message, signature: Uint8Array.from(await bridge.fixtureSign(Array.from(input.message))),
        }))) },
        "solana:signAndSendTransaction": { version: "1.0.0", supportedTransactionVersions: [0],
          signAndSendTransaction: async (...inputs: { transaction: Uint8Array }[]) => Promise.all(inputs.map(async input => ({
            signature: Uint8Array.from(await bridge.fixtureSend(Array.from(input.transaction))),
          }))) },
      } };
    window.addEventListener("wallet-standard:app-ready", event => {
      (event as CustomEvent<{ register(wallet: unknown): void }>).detail.register(wallet);
    });
    window.addEventListener("fixture-account-change", () => { accounts = []; listeners.forEach(listener => listener({ accounts })); });
  }, { owner: f.policy.owner, publicKey: Array.from(f.a.owner.publicKey.toBytes()) });
  return { rejectOnce() { rejectNext = true; } };
}
