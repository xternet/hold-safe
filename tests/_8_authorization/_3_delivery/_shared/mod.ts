import { getBase58Decoder, getTransactionDecoder, address } from "@solana/kit";
import { VersionedTransaction } from "@solana/web3.js";
import { FailedTransactionMetadata } from "litesvm";
import { type SignedAttempt } from "../../../../src/_kernel/mod";
import { buildExit, decodeEnvelope } from "../../../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { FeeGate } from "../../../../src/_adapters/_0_solana/_shared/_6_fees/mod";
import { policyAddress, stagingAddress } from "../../../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { readConnection } from "../../../../src/_adapters/_0_solana/_shared/_4_rpc/mod";
import { NativeDelivery } from "../../../../src/_adapters/_0_solana/_2_execution/_1_delivery/mod";
import { authorizationFixture } from "../../_shared/mod";

export async function deliveryFixture(armOnchain = true) {
  const f = await authorizationFixture(); if (armOnchain) f.armBound();
  const envelope = buildExit(f.policy, f.digest, f.native,
    { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1150, contextSlot: f.batch.slot },
    { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000", baseFeeLamports: "5000" });
  envelope.validity.serialized = JSON.stringify({ ...JSON.parse(envelope.validity.serialized), quoteExpiresAtMs: f.now() + 2000 });
  const { transaction } = decodeEnvelope(envelope); transaction.sign([f.a.keeper]);
  const signed: SignedAttempt = { chain: f.policy.chain, policyDigest: f.digest, bytesBase64: Buffer.from(transaction.serialize()).toString("base64"),
    nativeId: getBase58Decoder().decode(transaction.signatures[0]!), validity: envelope.validity };
  // Only finality, block height and provider behavior are synthetic. Transaction
  // bytes, native execution, logs, fees and token deltas come from actual SVM.
  const controls = [0, 1].map(() => ({ finality: "confirmed", absent: false, http: 200, loseSend: false,
    validHash: true, missingTransaction: false, alteredOutput: false, genesis: f.policy.chain.reference }));
  let recorded: Record<string, any> | null = null, nativeError: string | null = null, sends = 0;
  const tokens = (tx: VersionedTransaction) => [
    { key: f.policy.source, mint: f.policy.input.address, owner: f.policy.owner, decimals: 8 },
    { key: stagingAddress(f.policy).toBase58(), mint: f.policy.input.address, owner: policyAddress(f.policy).toBase58(), decimals: 8 },
    { key: f.policy.recipient, mint: f.policy.output.address, owner: f.policy.owner, decimals: 6 },
  ].map(item => ({ accountIndex: tx.message.staticAccountKeys.findIndex(key => key.toBase58() === item.key), mint: item.mint, owner: item.owner,
    uiTokenAmount: { amount: Buffer.from(f.get(item.key).data).readBigUInt64LE(64).toString(), decimals: item.decimals, uiAmount: null } }));
  function execute(bytes = Buffer.from(signed.bytesBase64, "base64")) {
    const tx = VersionedTransaction.deserialize(bytes), keys = tx.message.staticAccountKeys;
    const balances = () => keys.map(key => { const a = f.svm.getAccount(address(key.toBase58())); return a.exists ? Number(a.lamports) : 0; });
    const preBalances = balances(), preTokenBalances = tokens(tx);
    const result = f.svm.sendTransaction(getTransactionDecoder().decode(bytes));
    nativeError = result instanceof FailedTransactionMetadata ? result.toString() : null;
    const meta = result instanceof FailedTransactionMetadata ? result.meta() : result;
    const postBalances = balances(), postTokenBalances = tokens(tx);
    recorded = { slot: Number(f.svm.getClock().slot), blockTime: Number(f.svm.getClock().unixTimestamp), version: 0,
      transaction: { signatures: [getBase58Decoder().decode(tx.signatures[0]!)], message: { header: tx.message.header,
        accountKeys: keys.map(key => key.toBase58()), recentBlockhash: tx.message.recentBlockhash,
        instructions: tx.message.compiledInstructions.map(ix => ({ programIdIndex: ix.programIdIndex, accounts: ix.accountKeyIndexes, data: getBase58Decoder().decode(ix.data) })),
        addressTableLookups: [] } },
      meta: { err: nativeError, fee: preBalances[0]! - postBalances[0]!, preBalances, postBalances, preTokenBalances, postTokenBalances,
        logMessages: meta.logs(), innerInstructions: [], loadedAddresses: { writable: [], readonly: [] }, computeUnitsConsumed: Number(meta.computeUnitsConsumed()) } };
    return result;
  }
  const servers = controls.map(control => Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(), context = { slot: Number(f.svm.getClock().slot) };
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (control.http !== 200) return new Response("secret-provider-detail", { status: control.http });
    if (body.method === "getGenesisHash") return reply(control.genesis);
    if (body.method === "sendTransaction") {
      if ((body.params[1].skipPreflight !== undefined && body.params[1].skipPreflight !== false) || body.params[1].maxRetries !== 0 || body.params[1].preflightCommitment !== "confirmed") throw new Error("Unexpected native send configuration");
      const bytes = Buffer.from(body.params[0], "base64");
      sends++; execute(bytes);
      if (control.loseSend) return new Response("response lost after execution", { status: 503 });
      return reply(getBase58Decoder().decode(VersionedTransaction.deserialize(bytes).signatures[0]!));
    }
    if (body.method === "getSignatureStatuses") return reply({ context, value: [recorded === null || control.absent || body.params[0][0] !== recorded.transaction.signatures[0] ? null :
      { slot: recorded.slot, confirmations: control.finality === "finalized" ? null : 1, err: nativeError, confirmationStatus: control.finality }] });
    if (body.method === "isBlockhashValid") return reply({ context, value: control.validHash });
    if (body.method === "getTransaction") {
      if (control.missingTransaction || recorded === null || body.params[0] !== recorded.transaction.signatures[0]) return reply(null);
      const value = JSON.parse(JSON.stringify(recorded));
      if (control.alteredOutput) value.meta.postTokenBalances[2].uiTokenAmount.amount = "0";
      return reply(value);
    }
    return fetch(f.connection.rpcEndpoint, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  } }));
  const log = (fault: Parameters<typeof readConnection>[2] extends (f: infer F) => void ? F : never) => f.faults.push(fault);
  const sources = servers.map((server, index) => ({ id: `fixture-${index}`, connection: readConnection(server.url.origin, `fixture-${index}`, log) }));
  const fees = new FeeGate(sources[0]!.connection, { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" });
  const options = { primary: sources[0]!, backup: sources[1]!, catalog: f.catalog, manifest: f.manifest, keeper: f.policy.keeper,
    policy: async (digest: string) => { if (digest !== f.digest) throw new Error("Unknown fixture policy"); return f.policy; }, fees, log, now: f.now };
  return { ...f, signed, controls, sources, options, delivery: new NativeDelivery(options), execute, sends: () => sends,
    setHeight(height: number) { f.controls.blockHeight = height; },
    async stop() { for (const server of servers) await server.stop(true); await f.stop(); } };
}
