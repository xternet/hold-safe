import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import { validatePolicy, type Catalog, type Fault, type Health, type HoldingObservation, type Outcome, type Policy } from "../../../../_kernel/mod";
import { MAINNET, nativePolicy } from "../../_shared/mod";
import { decodeHolding } from "../_0_decode/mod";

export class HoldingReads {
  readonly chain = Object.freeze({ namespace: "solana", reference: MAINNET });
  private verified = false;
  private verifying: Promise<Outcome<void>> | undefined;
  private lastSlot = 0;
  private sourceAt: number | undefined;
  private reason = "No verified holding read";
  constructor(private readonly connection: Connection, private readonly catalog: Catalog,
    private readonly log: (fault: Fault) => void, private readonly now = Date.now) {}
  verifyNetwork(): Promise<Outcome<void>> {
    if (this.verified) return Promise.resolve({ ok: true, value: undefined });
    if (this.verifying !== undefined) return this.verifying;
    this.verifying = this.checkNetwork().finally(() => { this.verifying = undefined; });
    return this.verifying;
  }
  private async checkNetwork(): Promise<Outcome<void>> {
    try {
      if (await this.connection.getGenesisHash() !== MAINNET) return this.failure("RPC network mismatch", "genesis");
      this.verified = true; return { ok: true, value: undefined };
    } catch { return this.failure("Cannot verify RPC mainnet identity", "genesis"); }
  }
  async readHolding(policy: Policy, minimumSlot = 0): Promise<Outcome<HoldingObservation>> {
    let phase = "policy";
    try {
      validatePolicy(policy, this.catalog, Math.floor(this.now() / 1000)); nativePolicy(policy);
      if (!Number.isSafeInteger(minimumSlot) || minimumSlot < 0) throw new Error("Invalid minimum context slot");
      const verified = await this.verifyNetwork(); if (!verified.ok) return verified;
      phase = "accounts";
      const keys = [new PublicKey(policy.input.address), new PublicKey(policy.source), SYSVAR_CLOCK_PUBKEY];
      const floor = Math.max(this.lastSlot, minimumSlot);
      const batch = await this.connection.getMultipleAccountsInfoAndContext(keys, { commitment: "confirmed", minContextSlot: floor });
      if (batch.context.slot < floor || batch.value.length !== keys.length) throw new Error("Regressed/incomplete holding batch");
      const accounts = new Map<string, AccountInfo<Buffer>>();
      batch.value.forEach((value, index) => {
        const key = keys[index]; if (value === null || key === undefined) throw new Error("Missing holding account");
        accounts.set(key.toBase58(), value);
      });
      phase = "decode";
      const value = decodeHolding(policy, this.catalog, accounts, batch.context.slot, this.now());
      this.lastSlot = batch.context.slot; this.sourceAt = value.sourceAtMs; this.reason = "Fresh coherent holding state";
      return { ok: true, value };
    } catch (error) {
      const message = phase === "decode" && error instanceof Error ? `Native holding rejected: ${error.message}` : "Holding read unavailable or invalid";
      return this.failure(message, phase, policy.source);
    }
  }
  health(): Health {
    const now = this.now(), healthy = this.verified && this.sourceAt !== undefined && this.sourceAt <= now && now - this.sourceAt < 5000;
    return { source: "solana-mainnet", healthy, checkedAt: now, reason: healthy ? this.reason : this.reason === "Fresh coherent holding state" ? "Native state stale" : this.reason };
  }
  private failure(message: string, phase: string, account?: string): { ok: false; error: Fault } {
    this.sourceAt = undefined; this.reason = message;
    const context: Record<string, string> = { chain: MAINNET, phase, receivedAtMs: String(this.now()) };
    if (account !== undefined) context.account = account;
    const error: Fault = { code: "UNAVAILABLE", message, retryable: phase !== "policy", context };
    this.log(error); return { ok: false, error };
  }
}
