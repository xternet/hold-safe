import { Buffer } from "buffer";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, StandardDisconnect, StandardEvents, type StandardConnectFeature, type StandardDisconnectFeature, type StandardEventsFeature } from "@wallet-standard/features";
import { SolanaSignMessage, SolanaSignAndSendTransaction, type SolanaSignMessageFeature, type SolanaSignAndSendTransactionFeature } from "@solana/wallet-standard-features";
import { PublicKey } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import { copyValue, type UnsignedTransaction, type WalletPort } from "../../../../_kernel/mod";
import { MAINNET } from "../../_shared/_0_identity/mod";
import { validateOwnerTransaction, type OwnerReview } from "../_0_validate/mod";

type Features = StandardConnectFeature & StandardDisconnectFeature & StandardEventsFeature & SolanaSignMessageFeature & SolanaSignAndSendTransactionFeature;
export type SupportedWallet = Wallet & { features: Features };
export function supportedWallet(wallet: Wallet): wallet is SupportedWallet {
  const f = wallet.features as Partial<Features>;
  return wallet.chains.includes("solana:mainnet") && f[StandardConnect]?.version === "1.0.0" &&
    typeof f[StandardConnect]?.connect === "function" && f[StandardDisconnect]?.version === "1.0.0" &&
    typeof f[StandardDisconnect]?.disconnect === "function" && f[StandardEvents]?.version === "1.0.0" &&
    typeof f[StandardEvents]?.on === "function" && ["1.0.0", "1.1.0"].includes(String(f[SolanaSignMessage]?.version)) &&
    typeof f[SolanaSignMessage]?.signMessage === "function" && f[SolanaSignAndSendTransaction]?.version === "1.0.0" &&
    typeof f[SolanaSignAndSendTransaction]?.signAndSendTransaction === "function" &&
    Array.isArray(f[SolanaSignAndSendTransaction]?.supportedTransactionVersions) &&
    f[SolanaSignAndSendTransaction]!.supportedTransactionVersions.includes(0);
}
export function watchWallets(listener: (wallets: readonly Wallet[]) => void): () => void {
  const registry = getWallets(), update = () => listener(registry.get());
  const stopRegister = registry.on("register", update), stopUnregister = registry.on("unregister", update);
  update(); return () => { stopRegister(); stopUnregister(); };
}
function eligible(account: WalletAccount): boolean {
  return account.chains.includes("solana:mainnet") && account.features.includes(SolanaSignMessage) &&
    account.features.includes(SolanaSignAndSendTransaction) && account.publicKey.length === 32 &&
    new PublicKey(account.publicKey).toBase58() === account.address && PublicKey.isOnCurve(account.publicKey);
}
export async function connectWallet(wallet: Wallet): Promise<WalletPort> {
  if (!supportedWallet(wallet)) throw new Error("Wallet must support mainnet message signing and v0 sign-and-send");
  const result = await wallet.features[StandardConnect].connect();
  const selected = result.accounts.find(eligible);
  if (selected === undefined) throw new Error("Wallet has no eligible mainnet account");
  const owner = selected.address;
  const account = () => {
    const current = wallet.accounts.find(candidate => candidate.address === owner);
    if (current === undefined || !eligible(current)) throw new Error("Wallet account changed or disconnected; reconnect");
    return current;
  };
  account();
  return { owner, name: wallet.name, chain: Object.freeze({ namespace: "solana", reference: MAINNET }),
    onChange: (listener: () => void) => wallet.features[StandardEvents].on("change", listener),
    disconnect: () => wallet.features[StandardDisconnect].disconnect(),
    async signMessage(message: string): Promise<string> {
      if (typeof message !== "string" || message.length === 0 || message.length > 4096) throw new Error("Invalid sign-in message");
      const input = new TextEncoder().encode(message), current = account();
      const outputs = await wallet.features[SolanaSignMessage].signMessage({ account: current, message: input });
      account(); const output = outputs[0];
      if (outputs.length !== 1 || output === undefined || !Buffer.from(output.signedMessage).equals(Buffer.from(input)) ||
          output.signature.length !== 64 || (output.signatureType !== undefined && output.signatureType !== "ed25519")) throw new Error("Wallet changed the sign-in message");
      const key = await crypto.subtle.importKey("raw", Uint8Array.from(current.publicKey), "Ed25519", false, ["verify"]);
      if (!await crypto.subtle.verify("Ed25519", key, Uint8Array.from(output.signature), input)) throw new Error("Invalid wallet message signature");
      return Buffer.from(output.signature).toString("base64");
    },
    async send(input: UnsignedTransaction, reviewed: OwnerReview): Promise<string> {
      const envelope = copyValue(input), review = copyValue(reviewed);
      if (review.owner !== owner) throw new Error("Reviewed owner differs from connected wallet");
      const transaction = await validateOwnerTransaction(envelope, review), current = account();
      const outputs = await wallet.features[SolanaSignAndSendTransaction].signAndSendTransaction({
        account: current, chain: "solana:mainnet", transaction: transaction.serialize(),
        options: { commitment: "confirmed", preflightCommitment: "confirmed", skipPreflight: false, maxRetries: 0 },
      });
      const output = outputs[0];
      if (outputs.length !== 1 || output === undefined || output.signature.length !== 64) throw new Error("Wallet receipt unavailable; inspect policy status before retrying");
      const key = await crypto.subtle.importKey("raw", Uint8Array.from(current.publicKey), "Ed25519", false, ["verify"]);
      if (!await crypto.subtle.verify("Ed25519", key, Uint8Array.from(output.signature), Uint8Array.from(transaction.message.serialize()))) {
        throw new Error("Wallet receipt differs from reviewed transaction; inspect policy status");
      }
      return getBase58Decoder().decode(output.signature);
    } };
}
export type ConnectedWallet = Awaited<ReturnType<typeof connectWallet>>;
