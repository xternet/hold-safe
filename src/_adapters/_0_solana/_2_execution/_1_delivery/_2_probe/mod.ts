import { SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { GUARD, MAINNET } from "../../../_shared/mod";
import { assertPolicyBinding, decodePolicy, policyAddress } from "../../../_shared/_2_codec/mod";
import { GuardDeployment } from "../../../_shared/_5_guard/mod";
import type { ValidatedExit } from "../../_shared/_0_signed/mod";
import { DeliveryError, type DeliveryOptions, type RpcSource } from "../_shared/mod";

export async function probe(source: RpcSource, exit: ValidatedExit, options: DeliveryOptions) {
  const rpc = source.connection, deployment = new GuardDeployment(options.manifest);
  const [genesis, statuses] = await Promise.all([rpc.getGenesisHash(), rpc.getSignatureStatuses([exit.signed.nativeId], { searchTransactionHistory: true })]);
  if (genesis !== MAINNET || statuses.value.length !== 1 || !Number.isSafeInteger(statuses.context.slot) ||
    statuses.context.slot < exit.validity.contextSlot) throw new DeliveryError("RPC network or signature context differs");
  const status = statuses.value[0];
  if (status === undefined || (status !== null && (!Number.isSafeInteger(status.slot) || status.slot < exit.validity.contextSlot ||
    status.slot > statuses.context.slot || !["processed", "confirmed", "finalized"].includes(String(status.confirmationStatus))))) throw new DeliveryError("Invalid signature status");
  const minContextSlot = status !== null && status.confirmationStatus === "finalized" ? status.slot : exit.validity.contextSlot;
  const [batch, height, hash] = await Promise.all([
    rpc.getMultipleAccountsInfoAndContext([GUARD, deployment.programData, policyAddress(exit.policy), SYSVAR_CLOCK_PUBKEY], { commitment: "finalized", minContextSlot }),
    rpc.getBlockHeight({ commitment: "finalized", minContextSlot }),
    rpc.isBlockhashValid(exit.validity.blockhash, { commitment: "finalized", minContextSlot }),
  ]);
  const [program, data, account, clock] = batch.value;
  if (batch.value.length !== 4 || program === undefined || data === undefined || account === undefined || account === null || clock === undefined || clock === null ||
    !Number.isSafeInteger(batch.context.slot) || batch.context.slot < minContextSlot || clock.executable || account.executable ||
    clock.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" || clock.data.length !== 40 || clock.data.readBigUInt64LE(0) !== BigInt(batch.context.slot)) throw new DeliveryError("Invalid finalized policy batch");
  const sourceAtMs = Number(clock.data.readBigInt64LE(32)) * 1000, now = options.now();
  if (!Number.isSafeInteger(sourceAtMs) || sourceAtMs > now || now - sourceAtMs > 60000 ||
    !Number.isSafeInteger(height) || height <= 0 || !Number.isSafeInteger(hash.context.slot) || hash.context.slot < minContextSlot) throw new DeliveryError("Stale finalized RPC evidence");
  deployment.verify(program, data, batch.context.slot);
  const native = decodePolicy(account, policyAddress(exit.policy)); assertPolicyBinding(exit.policy, exit.signed.policyDigest, native);
  if (JSON.stringify(native.route) !== JSON.stringify(exit.route)) throw new DeliveryError("Signed route differs from authorized native route");
  return { source: source.id, status, slot: batch.context.slot, sourceAtMs, height, validHash: hash.value, native };
}
export type Probe = Awaited<ReturnType<typeof probe>>;
