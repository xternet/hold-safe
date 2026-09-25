import type { Catalog, ChainRef, Outcome, Policy } from "../../_0_types/mod";
import type { ExitQuote, NativeContext } from "../_0_market/mod";

export type UnsignedTransaction = {
  chain: ChainRef; purpose: "arm" | "revoke" | "exit";
  bytesBase64: string; validity: NativeContext;
};
export type SignedAttempt = {
  chain: ChainRef; policyDigest: string; nativeId: string;
  bytesBase64: string; validity: NativeContext;
};
export type Receipt = {
  nativeId: string; state: "pending" | "confirmed" | "failed" | "unknown" | "expired";
  context: NativeContext; checkedAtMs: number;
};
export type AuthorizationState = {
  policyDigest: string; state: "absent" | "active" | "consumed" | "revoked" | "expired";
  remainingRaw: string; delegate: string | null; sourceAtMs: number; receivedAtMs: number; context: NativeContext;
};
export interface AuthorizationPort {
  preview(policy: Policy): Promise<Outcome<{ networkFeesRaw: string; allocationRaw: string; limitations: string[] }>>;
  prepareArm(policy: Policy, digest: string, options: { replaceExistingApproval: boolean }): Promise<Outcome<UnsignedTransaction>>;
  prepareRevoke(policy: Policy): Promise<Outcome<UnsignedTransaction>>;
  read(policy: Policy): Promise<Outcome<AuthorizationState>>;
}
export interface ExecutionPort {
  build(policy: Policy, quote: ExitQuote): Promise<Outcome<UnsignedTransaction>>;
  simulate(transaction: UnsignedTransaction): Promise<Outcome<{ computeUnits: string; context: NativeContext }>>;
  signKeeper(policyDigest: string, transaction: UnsignedTransaction): Promise<Outcome<SignedAttempt>>;
  broadcast(attempt: SignedAttempt): Promise<Outcome<{ accepted: boolean }>>;
  reconcile(attempt: SignedAttempt): Promise<Outcome<Receipt>>;
}
// Browser-safe contract. Concrete wallet implementation is a separate entry.
export type OwnerReview = { owner: string; policy: Policy; catalog: Catalog; purpose: "arm" | "revoke";
  replaceExistingApproval: boolean; maximumNetworkFeeRaw: string; nowMs: number };
export interface WalletPort {
  readonly owner: string;
  readonly name: string;
  readonly chain: ChainRef;
  onChange(listener: () => void): () => void;
  signMessage(message: string): Promise<string>;
  send(transaction: UnsignedTransaction, review: OwnerReview): Promise<string>;
  disconnect(): Promise<void>;
}
