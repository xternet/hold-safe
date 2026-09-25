import { createHash } from "node:crypto";
import { Connection, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { policyDigest, validatePolicy, type AuthorizationState, type Catalog, type Fault, type Outcome, type Policy } from "../../../../_kernel/mod";
import { GUARD, MAINNET, nativePolicy } from "../../_shared/mod";
import { assertPolicyBinding, decodePolicy, policyAddress } from "../../_shared/_2_codec/mod";
import { GuardDeployment, type GuardManifest } from "../../_shared/_5_guard/mod";

export class AuthorizationReads {
  private readonly deployment: GuardDeployment;
  private network: Promise<void> | undefined;
  private lastSlot = 0;
  constructor(private readonly connection: Connection, private readonly catalog: Catalog, manifest: GuardManifest,
    private readonly log: (fault: Fault) => void, private readonly now = Date.now) { this.deployment = new GuardDeployment(manifest); }
  private async verifyNetwork(): Promise<void> {
    if (this.network === undefined) {
      this.network = this.connection.getGenesisHash().then(genesis => { if (genesis !== MAINNET) throw new Error("RPC network mismatch"); });
    }
    try { await this.network; }
    catch (error) { this.network = undefined; throw error; }
  }
  async read(policy: Policy): Promise<Outcome<AuthorizationState>> {
    let phase = "policy";
    try {
      validatePolicy(policy, this.catalog, 0); nativePolicy(policy);
      const digest = await policyDigest(policy), address = policyAddress(policy);
      phase = "rpc"; await this.verifyNetwork();
      const batch = await this.connection.getMultipleAccountsInfoAndContext([GUARD, this.deployment.programData, address, SYSVAR_CLOCK_PUBKEY],
        { commitment: "confirmed", minContextSlot: this.lastSlot });
      phase = "state";
      const [program, data, account, clock] = batch.value;
      if (batch.value.length !== 4 || program === undefined || data === undefined || account === undefined || clock === undefined || clock === null ||
          batch.context.slot < this.lastSlot || clock.executable || clock.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40) throw new Error("Invalid authorization batch");
      const now = this.now(), sourceAtMs = Number(clock.data.readBigInt64LE(32)) * 1000;
      if (!Number.isSafeInteger(batch.context.slot) || BigInt(batch.context.slot) !== clock.data.readBigUInt64LE(0) ||
          !Number.isSafeInteger(sourceAtMs) || sourceAtMs > now || now - sourceAtMs >= Math.min(5000, policy.rule.maxAgeMs)) throw new Error("Stale/incoherent authorization clock");
      this.deployment.verify(program, data, batch.context.slot);
      let state: AuthorizationState["state"] = "absent";
      if (account !== null) {
        if (account.executable) throw new Error("Executable policy account");
        const decoded = decodePolicy(account, address); assertPolicyBinding(policy, digest, decoded);
        state = decoded.state === "active" && policy.expiresAt <= Math.floor(now / 1000) ? "expired" : decoded.state;
      }
      this.lastSlot = batch.context.slot;
      return { ok: true, value: { policyDigest: digest, state, delegate: state === "absent" ? null : address.toBase58(),
        remainingRaw: state === "active" ? policy.amountRaw : "0", sourceAtMs, receivedAtMs: now,
        context: { adapter: "solana-authorization", version: 1, serialized: JSON.stringify({ slot: batch.context.slot,
          policyAddress: address.toBase58(), deployment: this.deployment.evidence(),
          policyHash: account === null ? null : createHash("sha256").update(account.data).digest("hex") }) } } };
    } catch (error) {
      const fault: Fault = { code: "UNAVAILABLE", message: phase !== "rpc" && error instanceof Error ? error.message : "Authorization RPC unavailable; details redacted",
        retryable: phase === "rpc", context: { adapter: "solana-authorization", phase, source: policy.source, receivedAtMs: String(this.now()) } };
      this.log(fault); return { ok: false, error: fault };
    }
  }
}
