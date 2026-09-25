import { Connection, PublicKey, TransactionMessage } from "@solana/web3.js";
import { copyValue, parseRaw, type UnsignedTransaction } from "../../../../_kernel/mod";
import { MAINNET } from "../_0_identity/mod";
import { decodeEnvelope } from "../_3_transactions/mod";
import { budget, type BlockValidity, type FeeSettings } from "../_3_transactions/_shared/mod";

export type FeeLimits = Omit<FeeSettings, "baseFeeLamports">;
export class FeeError extends Error {}
export class FeeGate {
  private readonly limits: FeeLimits;
  private network: Promise<void> | undefined;
  constructor(private readonly connection: Connection, limits: FeeLimits) {
    this.limits = copyValue(limits);
    if (!Number.isSafeInteger(limits.computeUnitLimit) || limits.computeUnitLimit <= 0 || limits.computeUnitLimit > 1400000 ||
        parseRaw(limits.microLamports, true) > 0xffffffffffffffffn) throw new FeeError("Invalid fee limits");
    parseRaw(limits.maxFeeLamports);
  }
  private async verify(): Promise<void> {
    if (this.network === undefined) this.network = this.connection.getGenesisHash().then(genesis => {
      if (genesis !== MAINNET) throw new FeeError("Fee RPC is not mainnet");
    });
    try { await this.network; } catch (error) { this.network = undefined; throw error; }
  }
  async prepare(payer: PublicKey): Promise<{ validity: BlockValidity; fees: FeeSettings }> {
    await this.verify();
    const latest = await this.connection.getLatestBlockhashAndContext("confirmed");
    if (!Number.isSafeInteger(latest.context.slot) || latest.context.slot <= 0 ||
        !Number.isSafeInteger(latest.value.lastValidBlockHeight) || latest.value.lastValidBlockHeight <= 0) throw new FeeError("Invalid block validity");
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: latest.value.blockhash, instructions: [] }).compileToV0Message();
    const base = await this.connection.getFeeForMessage(message, "confirmed");
    if (base.value === null || !Number.isSafeInteger(base.value) || base.value <= 0 || base.context.slot < latest.context.slot) throw new FeeError("Base fee unavailable");
    const fees = { ...this.limits, baseFeeLamports: String(base.value) };
    try { budget(fees); } catch { throw new FeeError("Estimated fee exceeds configured cap"); }
    return { validity: { ...latest.value, contextSlot: latest.context.slot }, fees };
  }
  async check(envelope: UnsignedTransaction, allocationRaw = "0"): Promise<{ feeLamports: string; balanceLamports: string; contextSlot: number }> {
    await this.verify();
    const { transaction, validity } = decodeEnvelope(envelope);
    const config = { commitment: "confirmed" as const, minContextSlot: validity.contextSlot };
    const [fee, balance, height] = await Promise.all([
      this.connection.getFeeForMessage(transaction.message, "confirmed"),
      this.connection.getBalanceAndContext(new PublicKey(validity.feePayer), config),
      this.connection.getBlockHeight(config),
    ]);
    if (!Number.isSafeInteger(height) || height < 0) throw new FeeError("Invalid block height");
    if (height > validity.lastValidBlockHeight) throw new FeeError("Transaction blockhash expired");
    if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value <= 0 || fee.context.slot < validity.contextSlot ||
        !Number.isSafeInteger(balance.value) || balance.value < 0 || balance.context.slot < validity.contextSlot) throw new FeeError("Fresh fee/balance unavailable");
    const raw = BigInt(fee.value);
    if (raw > parseRaw(this.limits.maxFeeLamports) || raw > parseRaw(validity.maxFeeLamports)) throw new FeeError("Actual RPC fee exceeds fee cap");
    if (BigInt(balance.value) < raw + parseRaw(allocationRaw, true)) throw new FeeError("Insufficient fee-payer balance");
    return { feeLamports: raw.toString(), balanceLamports: String(balance.value), contextSlot: Math.min(fee.context.slot, balance.context.slot) };
  }
}
