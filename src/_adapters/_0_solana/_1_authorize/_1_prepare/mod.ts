import { Connection, PublicKey } from "@solana/web3.js";
import { ACCOUNT_SIZE, getAccountLenForMint, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assetKey, parseRaw, policyDigest, validatePolicy, type Catalog, type Policy } from "../../../../_kernel/mod";
import { nativeMint, nativePolicy, nativeToken } from "../../_shared/mod";
import { policyAddress, stagingAddress } from "../../_shared/_2_codec/mod";
import { buildArm, buildRevoke } from "../../_shared/_3_transactions/mod";
import type { FeeGate } from "../../_shared/_6_fees/mod";
import type { NativeRouteAccess } from "../../_shared/_8_routes/mod";
import type { AuthorizationReads } from "../_0_read/mod";

export class AuthorizationError extends Error {}
export class AuthorizationPreparation {
  constructor(private readonly connection: Connection, private readonly catalog: Catalog, private readonly reads: AuthorizationReads,
    private readonly fees: FeeGate, private readonly route: NativeRouteAccess, private readonly now = Date.now) {}
  async preview(policy: Policy) {
    const result = await this.plan(policy, await policyDigest(policy), false, false);
    return { networkFeesRaw: result.fee, allocationRaw: result.allocation, limitations: [
      "The operator chooses execution timing within your approved amount, route and floor.",
      "Your minimum proceeds can prevent an exit during a severe decline.",
      "Freezes, empty liquidity and unavailable market data can prevent an exit.",
      ...result.limitations,
    ] };
  }
  async arm(policy: Policy, digest: string, options: { replaceExistingApproval: boolean }) {
    if (typeof options?.replaceExistingApproval !== "boolean") throw new AuthorizationError("Explicit delegate replacement choice required");
    return (await this.plan(policy, digest, options.replaceExistingApproval, true)).transaction;
  }
  async revoke(policy: Policy) {
    const read = await this.reads.read(policy);
    if (!read.ok) throw new AuthorizationError("Cannot verify current guard authorization");
    if (read.value.state !== "active" && read.value.state !== "expired") throw new AuthorizationError("No active native policy to cancel");
    const prepared = await this.fees.prepare(new PublicKey(policy.owner));
    const transaction = buildRevoke(policy, await policyDigest(policy), prepared.validity, prepared.fees);
    await this.fees.check(transaction); return transaction;
  }
  private async plan(policy: Policy, digest: string, replace: boolean, enforceChoice: boolean) {
    validatePolicy(policy, this.catalog, Math.floor(this.now() / 1000)); nativePolicy(policy);
    if (await policyDigest(policy) !== digest) throw new AuthorizationError("Policy digest mismatch");
    const read = await this.reads.read(policy);
    if (!read.ok) throw new AuthorizationError("Cannot verify guard deployment and policy state");
    if (read.value.state !== "absent") throw new AuthorizationError("Order already exists; use a fresh owner-authorized order");
    const quote = await this.route.venue.quote(policy, digest);
    if (!quote.ok) throw new AuthorizationError("No eligible native exit route");
    const native = await this.route.resolve(policy, quote.value);
    const inputKey = new PublicKey(policy.input.address), outputKey = new PublicKey(policy.output.address), owner = new PublicKey(policy.owner);
    const sourceKey = new PublicKey(policy.source), staging = stagingAddress(policy), recipient = new PublicKey(policy.recipient);
    const slot: number = JSON.parse(read.value.context.serialized).slot;
    const batch = await this.connection.getMultipleAccountsInfoAndContext([inputKey, outputKey, sourceKey, staging, recipient], { commitment: "confirmed", minContextSlot: slot });
    if (batch.context.slot < slot || batch.value.length !== 5) throw new AuthorizationError("Stale or incomplete account preparation");
    const [im, om, source, stage, destination] = batch.value;
    if (im === null || im === undefined || om === null || om === undefined || source === null || source === undefined || stage === undefined || destination === undefined) throw new AuthorizationError("Required owner/mint account missing");
    const inputSpec = this.catalog.assets.find(asset => assetKey(asset.ref) === assetKey(policy.input));
    const outputSpec = this.catalog.assets.find(asset => assetKey(asset.ref) === assetKey(policy.output));
    if (inputSpec === undefined || outputSpec === undefined) throw new AuthorizationError("Missing asset coverage");
    const input = nativeMint(inputKey, im, inputSpec.profile, inputSpec.decimals), output = nativeMint(outputKey, om, outputSpec.profile, outputSpec.decimals);
    const token = nativeToken(sourceKey, source, input.program, inputKey, owner);
    if (token.amount < parseRaw(policy.amountRaw)) throw new AuthorizationError("Insufficient input balance for fixed authorization");
    if (token.delegate !== null && enforceChoice && !replace) throw new AuthorizationError("Existing delegate requires explicit owner replacement approval");
    if (stage !== null) nativeToken(staging, stage, input.program, inputKey, policyAddress(policy));
    if (destination !== null) nativeToken(recipient, destination, output.program, outputKey, owner);
    else if (!getAssociatedTokenAddressSync(outputKey, owner, false, TOKEN_PROGRAM_ID).equals(recipient)) throw new AuthorizationError("Missing recipient must be the owner canonical ATA");
    const sizes = [579];
    if (stage === null) sizes.push(getAccountLenForMint(input.mint));
    if (destination === null) sizes.push(ACCOUNT_SIZE);
    const rents = await Promise.all(sizes.map(size => this.connection.getMinimumBalanceForRentExemption(size, "confirmed")));
    if (rents.some(rent => !Number.isSafeInteger(rent) || rent <= 0)) throw new AuthorizationError("Invalid account allocation estimate");
    const allocation = rents.reduce((sum, rent) => sum + BigInt(rent), 0n).toString();
    const prepared = await this.fees.prepare(owner);
    const transaction = buildArm(policy, digest, native.routeKeys, prepared.validity, prepared.fees, { replaceExistingApproval: replace, createRecipient: destination === null });
    const checked = await this.fees.check(transaction, allocation);
    return { transaction, allocation, fee: checked.feeLamports,
      limitations: token.delegate === null ? [] : ["An existing token delegate must be explicitly replaced when authorizing."] };
  }
}
