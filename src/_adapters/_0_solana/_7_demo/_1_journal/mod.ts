import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import type { Policy } from "../../../../_kernel/mod";
export type DemoState = { run: number; phase: string; scenario: string; policy: Policy | null; digest: string;
  baselineSupply: string; reason: string; receipts: { kind: string; signature: string }[]; mode: "replay" | "live" };
export type IssuedOwnerPacket={message:string;height:number;kind:"authorize"|"revoke";run:number};
export class DemoJournal {
  readonly db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at TEXT NOT NULL,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS packets(signature TEXT PRIMARY KEY,raw TEXT NOT NULL,kind TEXT NOT NULL,height INTEGER NOT NULL,status TEXT NOT NULL);");
    this.db.exec("CREATE TABLE IF NOT EXISTS owner_packet(id INTEGER PRIMARY KEY CHECK(id=1),document TEXT NOT NULL)");
    if (this.db.query("SELECT id FROM state").get() === null) this.save({ run: 1, phase: "ready", scenario: "none", policy: null, digest: "", baselineSupply: "", reason: "Ready to authorize a Devnet demo policy", receipts: [], mode: "replay" });
  }
  read(): DemoState { const row = this.db.query("SELECT document FROM state WHERE id=1").get() as { document: string }; return JSON.parse(row.document); }
  save(state: DemoState): void {
    const previous = this.db.query("SELECT document FROM state WHERE id=1").get() as { document: string } | null;
    if (previous !== null) {
      const old: DemoState = JSON.parse(previous.document);
      if (old.run === state.run && old.policy !== null && JSON.stringify(old.policy) !== JSON.stringify(state.policy)) throw new Error("Cannot rewrite signed demo policy");
      if (state.run !== old.run && this.pending().length !== 0) throw new Error("Cannot reset with pending transactions");
      if (state.run !== old.run && this.issued()!==null) throw new Error("Cannot reset with an outstanding wallet packet");
      if (state.run < old.run || state.run > old.run + 1) throw new Error("Invalid demo run sequence");
    }
    this.db.transaction(() => {
      this.db.query("INSERT INTO events(at,document) VALUES(?,?)").run(new Date().toISOString(), JSON.stringify(state));
      this.db.query("INSERT INTO state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document").run(JSON.stringify(state));
    })();
  }
  issued():IssuedOwnerPacket|null {
    const row=this.db.query("SELECT document FROM owner_packet WHERE id=1").get() as {document:string}|null;
    return row===null?null:JSON.parse(row.document);
  }
  issue(packet:IssuedOwnerPacket){
    if(packet.run!==this.read().run||!Number.isSafeInteger(packet.height)||packet.height<=0)throw new Error("Invalid owner packet domain");
    this.db.query("INSERT INTO owner_packet VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document").run(JSON.stringify(packet));
  }
  clearIssued(){this.db.exec("DELETE FROM owner_packet WHERE id=1");}
  prepare(signature: string, raw: string, kind: string, height: number): void {
    if (this.pending().length !== 0) throw new Error("Reconcile pending transaction before another action");
    this.db.query("INSERT INTO packets VALUES(?,?,?,?, 'pending')").run(signature, raw, kind, height);
  }
  pending() { return this.db.query("SELECT signature,raw,kind,height FROM packets WHERE status='pending'").all() as { signature: string; raw: string; kind: string; height: number }[]; }
  finish(signature: string, status: "finalized" | "failed" | "expired") { this.db.query("UPDATE packets SET status=? WHERE signature=? AND status='pending'").run(status, signature); }
  finalize(signature:string,kind:string) {
    this.db.transaction(()=>{
      const pending=this.pending().find(p=>p.signature===signature);
      if(pending===undefined||pending.kind!==kind)throw new Error("Missing pending receipt");
      const state=this.read();state.receipts.push({kind,signature});
      this.finish(signature,"finalized");this.save(state);
    })();
  }
  history() { return this.db.query("SELECT signature,kind,status FROM packets ORDER BY rowid DESC LIMIT 30").all(); }
  close() { this.db.close(); }
}
