import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { address, getTransactionDecoder } from "@solana/kit";
import { FailedTransactionMetadata } from "litesvm";
import { PublicKey, VersionedMessage } from "@solana/web3.js";
import { quoteFixture } from "../../_6_quotes/_shared/mod";
import { policyDigest, type Fault, type Policy, type VenuePort, type ExitQuote } from "../../../src/_kernel/mod";
import { QuoteBook } from "../../../src/_adapters/_0_solana/_venues/_0_raydium/_2_book/mod";
import { GUARD } from "../../../src/_adapters/_0_solana/_shared/mod";
import { authorizeInstruction } from "../../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { quoteNativeState } from "../../../src/_adapters/_0_solana/_venues/_0_raydium/_0_math/mod";
import { readConnection } from "../../../src/_adapters/_0_solana/_shared/_4_rpc/mod";
import { send } from "../../_2_swap/_1_fixture/_1_accounts/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";

export async function authorizationFixture() {
  const f = quoteFixture(), digest = await policyDigest(f.policy), native = quoteNativeState(f.policy, f.catalog, f.batch);
  const get = (key: string) => { const account = f.svm.getAccount(address(key)); if (!account.exists) throw new Error("Missing SVM fixture account"); return account; };
  const programData = new PublicKey(Buffer.from(get(GUARD.toBase58()).data).subarray(4)).toBase58();
  const bytes = Buffer.from(get(programData).data), binary = readFileSync(".tools/guard/solstock_guard.so");
  const manifest = { version: "solstock-guard-v1", programData, deploymentSlot: bytes.readBigUInt64LE(4).toString(),
    authority: null as string | null, binaryLength: binary.length, binaryHash: createHash("sha256").update(binary).digest("hex") };
  // RPC protocol controls are synthetic; token/program state remains actual SVM state.
  const faults: Fault[] = [], controls = { genesis: f.policy.chain.reference, status: 200, baseFee: 5000, totalFee: 5000, feeMissing: false, blockHeight: 1000, inventoryAccounts: [f.policy.source] };
  const now = () => Number(f.svm.getClock().unixTimestamp) * 1000;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json();
    if (controls.status !== 200) return new Response("private-provider-message", { status: controls.status });
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const context = { slot: Number(f.svm.getClock().slot) };
    if (body.method === "getGenesisHash") return reply(controls.genesis);
    if (body.method === "getTokenAccountsByOwner") {
      if (body.params[0] !== f.policy.owner || body.params[1].mint !== f.policy.input.address) throw new Error("Unexpected inventory filter");
      return reply({ context, value: controls.inventoryAccounts.map(key => {
        const account = get(key);
        return { pubkey: key, account: { owner: account.programAddress, lamports: Number(account.lamports), executable: account.executable,
          data: [Buffer.from(account.data).toString("base64"), "base64"], rentEpoch: 0 } };
      }) });
    }
    if (body.method === "getLatestBlockhash") return reply({ context, value: { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: controls.blockHeight + 150 } });
    if (body.method === "getBlockHeight") return reply(controls.blockHeight);
    if (body.method === "getBalance") {
      const account = f.svm.getAccount(address(body.params[0]));
      return reply({ context, value: account.exists ? Number(account.lamports) : 0 });
    }
    if (body.method === "getFeeForMessage") {
      const message = VersionedMessage.deserialize(Buffer.from(body.params[0], "base64"));
      return reply({ context, value: controls.feeMissing ? null : message.compiledInstructions.length === 0 ? controls.baseFee : controls.totalFee });
    }
    if (body.method === "getMinimumBalanceForRentExemption") return reply(Number(f.svm.minimumBalanceForRentExemption(BigInt(body.params[0]))));
    if (body.method === "simulateTransaction") {
      if (body.params[1].sigVerify !== false || body.params[1].replaceRecentBlockhash === true) throw new Error("Unexpected simulation configuration");
      // Same unsigned simulation semantics as RPC, actual SVM programs/state.
      f.svm.withSigverify(false);
      try {
        const simulation = f.svm.simulateTransaction(getTransactionDecoder().decode(Buffer.from(body.params[0], "base64")));
        const meta = simulation.meta();
        return reply({ context, value: { err: simulation instanceof FailedTransactionMetadata ? simulation.toString() : null,
          logs: meta.logs(), unitsConsumed: Number(meta.computeUnitsConsumed()) } });
      } finally { f.svm.withSigverify(true); }
    }
    if (body.method !== "getMultipleAccounts") throw new Error(`Unimplemented local RPC method ${body.method}`);
    const value = body.params[0].map((key: string) => {
      const account = f.svm.getAccount(address(key)); if (!account.exists) return null;
      return { owner: account.programAddress, lamports: Number(account.lamports), executable: account.executable,
        data: [Buffer.from(account.data).toString("base64"), "base64"], rentEpoch: 0 };
    });
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { context: { slot: Number(f.svm.getClock().slot) }, value } });
  } });
  const connection = readConnection(server.url.origin, "local-svm", fault => faults.push(fault));
  const book = new QuoteBook(now);
  const venue: VenuePort = { id: "raydium-clmm-v1",
    quote: async (policy, digest) => ({ ok: true, value: book.issue(policy, digest, quoteNativeState(policy, f.catalog, f.batch)) }),
    validateRoute: async (policy, quote) => { book.validate(policy, await policyDigest(policy), quote); return { ok: true, value: undefined }; } };
  const route = { venue, resolve: async (policy: Policy, quote: ExitQuote) => book.validate(policy, await policyDigest(policy), quote) };
  return { ...f, digest, native, manifest, faults, controls, connection, now, get, route,
    armBound() { assertSuccess(send(f.svm, [authorizeInstruction(f.policy, digest, native.routeKeys, false)], f.a.owner)); },
    async stop() { await server.stop(true); } };
}
