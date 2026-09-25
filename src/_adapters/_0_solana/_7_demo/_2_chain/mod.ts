import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { getBase58Decoder } from "@solana/kit";
import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DEVNET, DEMO_GUARD, DEMO_DEX } from "../../_shared/mod";
import { GuardDeployment, type GuardManifest } from "../../_shared/_5_guard/mod";
import { DemoJournal } from "../_1_journal/mod";
export type DemoEnvironment = { genesis: string; operator: string; guard: string; manifest: GuardManifest;
  assets: { symbol: string; mint: string; account: string; program: string; decimals: number }[];
  pool: { address: string; config: string; dex: string }; judge: { owner: string; source: string; recipient: string } };
export class DemoChain {
  readonly rpc = new Connection("https://api.devnet.solana.com", "confirmed");
  constructor(readonly env: DemoEnvironment, readonly operator: Keypair, readonly journal: DemoJournal) {}
  static async open(path: string) {
    const env: DemoEnvironment = JSON.parse(await readFile(path, "utf8"));
    if (env.genesis !== DEVNET || env.guard !== DEMO_GUARD.toBase58() || env.pool.dex !== DEMO_DEX.toBase58() || env.assets.length !== 2 || !env.judge) throw new Error("Invalid Devnet fixture");
    const keyPath = "secrets/devnet-demo-operator-keypair.json", stat = await lstat(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid!()) throw new Error("Insecure demo operator file");
    const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8"))));
    if (operator.publicKey.toBase58() !== env.operator) throw new Error("Demo operator mismatch");
    const chain = new DemoChain(env, operator, new DemoJournal("secrets/devnet-demo.sqlite"));
    await chain.verify(); return chain;
  }
  async verify() {
    if (await this.rpc.getGenesisHash() !== DEVNET) throw new Error("Refusing non-Devnet RPC");
    const deployment = new GuardDeployment(this.env.manifest, DEMO_GUARD);
    const batch = await this.rpc.getMultipleAccountsInfoAndContext([DEMO_GUARD, deployment.programData], "finalized");
    deployment.verify(batch.value[0]!, batch.value[1]!, batch.context.slot);
  }
  async programVersion() {
    const program = await this.rpc.getAccountInfo(DEMO_DEX);
    if (!program?.executable || program.data.length !== 36) throw new Error("Missing Devnet DEX");
    const data = await this.rpc.getAccountInfo(new PublicKey(program.data.subarray(4)));
    if (data === null) throw new Error("Missing DEX program data");
    return `slot:${data.data.readBigUInt64LE(4)}:sha256:${createHash("sha256").update(data.data.subarray(45)).digest("hex")}`;
  }
  async unsigned(instructions: TransactionInstruction[], payer: PublicKey) {
    const block = await this.rpc.getLatestBlockhash("confirmed");
    return { transaction: new Transaction({ feePayer: payer, ...block }).add(...instructions), block };
  }
  async send(kind: string, instructions: TransactionInstruction[]) {
    await this.verify();
    const { transaction, block } = await this.unsigned(instructions, this.operator.publicKey);
    transaction.sign(this.operator); return this.submit(kind, transaction, block.lastValidBlockHeight);
  }
  async submit(kind: string, transaction: Transaction, height: number) {
    if (!transaction.verifySignatures()) throw new Error("Invalid transaction signatures");
    const signature = getBase58Decoder().decode(transaction.signature!), raw = transaction.serialize().toString("base64");
    this.journal.prepare(signature, raw, kind, height);
    try {
      const result = await this.rpc.sendRawTransaction(Buffer.from(raw,"base64"), { preflightCommitment: "confirmed", maxRetries: 2 });
      if (result !== signature) throw new Error("RPC signature mismatch");
    } catch (error) { console.error(JSON.stringify({ phase: "demo-send", signature, error: error instanceof Error ? error.message : "unknown" })); }
    for (let i = 0; i < 45; i++) {
      const status = await this.reconcile();
      if (status !== "pending") { if (status !== "finalized") throw new Error(`Demo transaction ${status}`); return signature; }
      await Bun.sleep(2500);
    }
    throw new Error("Transaction still pending; reconciliation will continue");
  }
  async reconcile(): Promise<string> {
    const pending = this.journal.pending(); if (pending.length === 0) return "none";
    const p = pending[0]!, value = (await this.rpc.getSignatureStatuses([p.signature], { searchTransactionHistory: true })).value[0];
    if (value?.err) { this.journal.finish(p.signature,"failed"); return "failed"; }
    if (value?.confirmationStatus === "finalized") {
      this.journal.finalize(p.signature,p.kind); return "finalized";
    }
    if (value === null && await this.rpc.getBlockHeight("finalized") > p.height) { this.journal.finish(p.signature,"expired"); return "expired"; }
    return "pending";
  }
}
