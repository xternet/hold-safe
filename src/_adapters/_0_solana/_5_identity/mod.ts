import { PublicKey } from "@solana/web3.js";
import type { WalletIdentityPort } from "../../../_kernel/mod";
import { MAINNET } from "../_shared/_0_identity/mod";

export function createWalletIdentity(): WalletIdentityPort {
  function validOwner(owner: string): boolean {
    if (typeof owner !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner)) return false;
    try { const key = new PublicKey(owner); return key.toBase58() === owner && PublicKey.isOnCurve(key.toBytes()); }
    catch { return false; } // Invalid untrusted address is an expected verification result.
  }
  return { chain: Object.freeze({ namespace: "solana", reference: MAINNET }), validOwner,
    async verify(owner, message, signatureBase64) {
      if (!validOwner(owner) || typeof message !== "string" || message.length > 4096 || typeof signatureBase64 !== "string" ||
          !/^[A-Za-z0-9+/]{86}==$/.test(signatureBase64)) return false;
      const bytes = Buffer.from(signatureBase64, "base64");
      if (bytes.length !== 64 || bytes.toString("base64") !== signatureBase64) return false;
      const key = await crypto.subtle.importKey("raw", Uint8Array.from(new PublicKey(owner).toBytes()), { name: "Ed25519" }, false, ["verify"]);
      return crypto.subtle.verify("Ed25519", key, Uint8Array.from(bytes), new TextEncoder().encode(message));
    } };
}
