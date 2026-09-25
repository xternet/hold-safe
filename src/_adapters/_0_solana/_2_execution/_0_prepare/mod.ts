import { Keypair, type Connection } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import { assetKey, copyValue, parseRaw, policyDigest, type AuthorizationPort, type ChainReader, type ExitQuote,
  type Fault, type Outcome, type Policy, type SignedAttempt, type UnsignedTransaction } from "../../../../_kernel/mod";
import { nativePolicy } from "../../_shared/mod";
import { policyAddress } from "../../_shared/_2_codec/mod";
import { buildExit, decodeEnvelope } from "../../_shared/_3_transactions/mod";
import { FeeError, type FeeGate } from "../../_shared/_6_fees/mod";
import type { NativeRouteAccess } from "../../_shared/_8_routes/mod";

type Entry = { policy: Policy; digest: string; quote: ExitQuote; envelope: UnsignedTransaction; computeLimit: number;
  state: "built" | "simulating" | "simulated" | "signing"; simulationSlot: number };
class ExitError extends Error {
  constructor(message: string, readonly context: Record<string, string> = {}) { super(message); }
}
export class ExitPreparation {
  private readonly entries = new Map<string, Entry>();
  private readonly keeper: Keypair;
  constructor(private readonly connection: Connection, private readonly authorization: Pick<AuthorizationPort, "read">,
    private readonly holdings: Pick<ChainReader, "readHolding">, private readonly route: NativeRouteAccess, private readonly fees: FeeGate,
    keeper: Keypair, private readonly log: (fault: Fault) => void, private readonly now = Date.now) {
    this.keeper = Keypair.fromSecretKey(keeper.secretKey);
  }
  build(document: Policy, observation: ExitQuote): Promise<Outcome<UnsignedTransaction>> {
    const policy = copyValue(document), quote = copyValue(observation);
    return this.attempt("build", async () => {
      nativePolicy(policy);
      const digest = await policyDigest(policy);
      if (policy.keeper !== this.keeper.publicKey.toBase58() || quote.policyDigest !== digest) throw new ExitError("Keeper or policy digest mismatch");
      const native = await this.route.resolve(policy, quote);
      await this.authority(policy, digest, 0);
      const prepared = await this.fees.prepare(this.keeper.publicKey);
      const envelope = buildExit(policy, digest, native, prepared.validity, prepared.fees);
      envelope.validity.serialized = JSON.stringify({ ...JSON.parse(envelope.validity.serialized), quoteExpiresAtMs: quote.expiresAtMs });
      await this.fees.check(envelope);
      for (const [key, entry] of this.entries) if (entry.quote.expiresAtMs <= this.now()) this.entries.delete(key);
      if (this.entries.size >= 1024) throw new ExitError("Exit preparation capacity reached");
      const key = decodeEnvelope(envelope).validity.messageHash;
      if (this.entries.has(key)) throw new ExitError("Exit message already issued");
      const entry: Entry = { policy, digest, quote, envelope: copyValue(envelope), computeLimit: prepared.fees.computeUnitLimit, state: "built", simulationSlot: 0 };
      this.fresh(entry); this.entries.set(key, entry); return copyValue(envelope);
    });
  }
  simulate(envelope: UnsignedTransaction) {
    return this.attempt("simulate", async () => {
      const { key, entry } = this.issued(envelope);
      if (entry.state !== "built") throw new ExitError("Exit is not awaiting simulation");
      entry.state = "simulating";
      try {
        const { transaction, validity } = decodeEnvelope(entry.envelope);
        const result = await this.connection.simulateTransaction(transaction, { commitment: "confirmed", sigVerify: false,
          replaceRecentBlockhash: false, minContextSlot: validity.contextSlot });
        if (result.value.err !== null) throw new ExitError("Guard exit simulation rejected", {
          simulationError: JSON.stringify(result.value.err), slot: String(result.context.slot), policyDigest: entry.digest,
          logs: result.value.logs === null || result.value.logs === undefined ? "unavailable" : JSON.stringify(result.value.logs) });
        const units = result.value.unitsConsumed;
        if (units === undefined || !Number.isSafeInteger(units) || units <= 0 || units > entry.computeLimit || result.context.slot < validity.contextSlot) throw new ExitError("Invalid or stale simulation evidence");
        this.fresh(entry); entry.simulationSlot = result.context.slot; entry.state = "simulated";
        return { computeUnits: String(units), context: { adapter: "solana-simulation", version: 1,
          serialized: JSON.stringify({ slot: result.context.slot, messageHash: validity.messageHash, computeUnits: units }) } };
      } catch (error) { this.entries.delete(key); throw error; }
    });
  }
  signKeeper(digest: string, envelope: UnsignedTransaction): Promise<Outcome<SignedAttempt>> {
    return this.attempt("sign", async () => {
      const { key, entry } = this.issued(envelope);
      if (digest !== entry.digest || entry.state !== "simulated") throw new ExitError("Exit not simulated or policy digest differs");
      entry.state = "signing";
      try {
        await this.authority(entry.policy, entry.digest, entry.simulationSlot);
        const route = await this.route.venue.validateRoute(entry.policy, entry.quote);
        if (!route.ok) throw new ExitError("Native route no longer eligible");
        await this.fees.check(entry.envelope); this.fresh(entry);
        const { transaction } = decodeEnvelope(entry.envelope); transaction.sign([this.keeper]);
        const signature = transaction.signatures[0];
        if (signature === undefined || signature.every(byte => byte === 0)) throw new ExitError("Keeper signature unavailable");
        return { chain: copyValue(entry.policy.chain), policyDigest: digest, nativeId: getBase58Decoder().decode(signature),
          bytesBase64: Buffer.from(transaction.serialize()).toString("base64"), validity: copyValue(entry.envelope.validity) };
      } finally { this.entries.delete(key); }
    });
  }
  private issued(envelope: UnsignedTransaction): { key: string; entry: Entry } {
    const decoded = decodeEnvelope(envelope), key = decoded.validity.messageHash, entry = this.entries.get(key);
    if (entry === undefined || envelope.purpose !== "exit" || envelope.bytesBase64 !== entry.envelope.bytesBase64 ||
      envelope.validity.serialized !== entry.envelope.validity.serialized) throw new ExitError("Unissued or altered exit envelope");
    this.fresh(entry); return { key, entry };
  }
  private fresh(entry: Entry): void {
    const now = this.now();
    if (entry.quote.quotedAtMs > now || now >= entry.quote.expiresAtMs || now >= entry.policy.expiresAt * 1000) throw new ExitError("Exit quote or policy expired");
  }
  private async authority(policy: Policy, digest: string, minimumSlot: number): Promise<void> {
    const [authorization, holding] = await Promise.all([this.authorization.read(policy), this.holdings.readHolding(policy)]);
    if (!authorization.ok || !holding.ok) throw new ExitError("Current authorization or holding unavailable");
    const a = authorization.value, h = holding.value, delegate = policyAddress(policy).toBase58(), amount = parseRaw(policy.amountRaw), now = this.now();
    if (a.state !== "active" || a.policyDigest !== digest || a.delegate !== delegate || h.delegate !== delegate ||
      h.account !== policy.source || h.owner !== policy.owner || assetKey(h.asset) !== assetKey(policy.input) ||
      parseRaw(a.remainingRaw, true) < amount || parseRaw(h.allowanceRaw, true) < amount || parseRaw(h.balanceRaw, true) < amount || h.frozen !== false || h.paused !== false) throw new ExitError("Authorization revoked, consumed or insufficient");
    for (const value of [a, h]) {
      const slot: unknown = JSON.parse(value.context.serialized).slot;
      if (!Number.isSafeInteger(slot) || Number(slot) < minimumSlot || value.sourceAtMs > now || now - value.sourceAtMs >= Math.min(5000, policy.rule.maxAgeMs)) throw new ExitError("Authority observation stale or behind simulation");
    }
  }
  private async attempt<T>(action: string, work: () => Promise<T>): Promise<Outcome<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) {
      const fault: Fault = { code: "UNAVAILABLE", message: error instanceof ExitError || error instanceof FeeError ? error.message : "Native exit operation unavailable; details redacted",
        retryable: true, context: { adapter: "solana-execution", action, receivedAtMs: String(this.now()), ...(error instanceof ExitError ? error.context : {}) } };
      this.log(fault); return { ok: false, error: fault };
    }
  }
}
