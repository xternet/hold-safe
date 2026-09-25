import {Database} from "bun:sqlite";
import {mkdirSync,chmodSync} from "node:fs";
import {PublicKey,SystemProgram} from "@solana/web3.js";
import {getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createMintToInstruction,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from "@solana/spl-token";
import {DemoChain} from "../_2_chain/mod";
import {DemoJournal} from "../_1_journal/mod";
import {DemoMarket} from "../_3_controls/_0_market/mod";
import {DemoRuntime} from "../_4_runtime/mod";
export function canRelease(s:{busy:boolean;pending:number;issuedHeight:number|null;height:number;policyExpiry:number|null;leaseUntil:number},now:number){
 return !s.busy&&s.pending===0&&(s.issuedHeight===null||s.height>s.issuedHeight)&&(s.policyExpiry===null||now>s.policyExpiry)&&now>s.leaseUntil;
}
/** One market, one wallet lease. Funding is durably reserved before any send. */
export class DemoLobby {
 readonly db:Database;
 private lock:Promise<void>=Promise.resolve();
 private constructor(readonly base:DemoRuntime,public current:DemoRuntime){
  mkdirSync("secrets/judges",{recursive:true,mode:0o700});
  this.db=new Database("secrets/judges/lobby.sqlite");chmodSync("secrets/judges/lobby.sqlite",0o600);
  this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS guests(owner TEXT PRIMARY KEY, funding TEXT NOT NULL, resets INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS active(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,until_ms INTEGER NOT NULL);");
 }
 static async open(base:DemoRuntime){
  const lobby=new DemoLobby(base,base);await lobby.recoverBase();const active=lobby.active();
  if(active!==null&&active.owner!==base.market.chain.env.judge.owner)lobby.current=await lobby.runtime(active.owner);
  return lobby;
 }
 private async recoverBase(){
  const chain=this.base.market.chain,state=chain.journal.read();if(state.phase==="ready")return;
  if(chain.journal.pending().length){await chain.reconcile();if(chain.journal.pending().length)return;}
  const issued=chain.journal.issued(),native=state.policy===null?"absent":await this.base.market.native(state.policy,state.digest,"finalized");
  if(native==="active")return;
  if(issued!==null&&await chain.rpc.getBlockHeight("finalized")<=issued.height)return;
  await this.base.reset();
 }
 private active(){return this.db.query("SELECT owner,until_ms FROM active WHERE id=1").get() as {owner:string;until_ms:number}|null;}
 private async serialized<T>(fn:()=>Promise<T>){
  const before=this.lock;let release!:()=>void;this.lock=new Promise<void>(r=>{release=r;});await before;
  try{return await fn();}finally{release();}
 }
 private async runtime(owner:string){
  if(owner===this.base.market.chain.env.judge.owner)return this.base;
  const env=structuredClone(this.base.market.chain.env),key=new PublicKey(owner);
  env.judge={owner,source:getAssociatedTokenAddressSync(new PublicKey(env.assets[0]!.mint),key,false,TOKEN_2022_PROGRAM_ID).toBase58(),recipient:getAssociatedTokenAddressSync(new PublicKey(env.assets[1]!.mint),key,false,TOKEN_PROGRAM_ID).toBase58()};
  return new DemoRuntime(await DemoMarket.open(new DemoChain(env,this.base.market.chain.operator,new DemoJournal(`secrets/judges/${owner}.sqlite`))));
 }
 async acquire(owner:string){return this.serialized(async()=>{
  const key=new PublicKey(owner);if(!PublicKey.isOnCurve(key.toBytes()))throw new Error("Connect a signing wallet");
  const old=this.current,chain=old.market.chain,active=this.active();
  if(owner!==chain.env.judge.owner){
   const state=chain.journal.read(),issued=chain.journal.issued();
   const height=await chain.rpc.getBlockHeight("finalized");
   const native=state.policy===null?"absent":await old.market.native(state.policy,state.digest,"finalized");
   const until=active===null?0:active.until_ms;
   if(!canRelease({busy:old.busy,pending:chain.journal.pending().length,issuedHeight:issued===null?null:issued.height,height,policyExpiry:native==="active"?state.policy!.expiresAt*1000:null,leaseUntil:until},Date.now()))
    throw new Error("Another judge has the live session. Try the recorded demo, then retry later (idle leases and authorizations expire after 15 minutes).");
  }
  const guest=this.db.query("SELECT funding FROM guests WHERE owner=?").get(owner) as {funding:string}|null;
  if(guest===null){
   const count=this.db.query("SELECT count(*) AS n FROM guests").get() as {n:number};
   if(count.n>=12)throw new Error("Free demo wallet allocation exhausted. The recorded demo remains available.");
  }
  if(owner!==chain.env.judge.owner){
   this.current=await this.runtime(owner);
   if(old!==this.base)old.market.chain.journal.close();
   this.db.query("INSERT INTO active VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms").run(owner,Date.now()+900000);
  }else if(active===null||active.until_ms<Date.now())this.db.query("INSERT INTO active VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms").run(owner,Date.now()+900000);
  const runtime=this.current;
  if(guest===null){
   this.db.query("INSERT INTO guests(owner,funding) VALUES(?,'reserved')").run(owner);
   await this.fund(runtime);await runtime.actions.restore();
   this.db.query("UPDATE guests SET funding='confirmed' WHERE owner=?").run(owner);
  }else if(guest.funding!=="confirmed"){
   if(runtime.market.chain.journal.pending().length)await runtime.market.chain.reconcile();
   const receipt=runtime.market.chain.journal.history() as {kind:string;status:string}[];
   if(!receipt.some(p=>p.kind==="judge-funding"&&p.status==="finalized"))throw new Error("Wallet funding is pending or interrupted. Please retry later; no duplicate grant will be sent.");
   await runtime.actions.restore();
   this.db.query("UPDATE guests SET funding='confirmed' WHERE owner=?").run(owner);
  }else if(owner!==chain.env.judge.owner){await runtime.actions.restore();}
  return runtime;
 });}
 private async fund(runtime:DemoRuntime){
  const {chain}=runtime.market,{env,operator}=chain,owner=new PublicKey(env.judge.owner),source=new PublicKey(env.judge.source),recipient=new PublicKey(env.judge.recipient);
  if(await chain.rpc.getBalance(operator.publicKey)<100000000)throw new Error("Devnet faucet reserve is low. Recorded demo remains available.");
  await chain.send("judge-funding",[
   SystemProgram.transfer({fromPubkey:operator.publicKey,toPubkey:owner,lamports:30000000}),
   createAssociatedTokenAccountIdempotentInstruction(operator.publicKey,source,owner,new PublicKey(env.assets[0]!.mint),TOKEN_2022_PROGRAM_ID),
   createAssociatedTokenAccountIdempotentInstruction(operator.publicKey,recipient,owner,new PublicKey(env.assets[1]!.mint),TOKEN_PROGRAM_ID),
   createMintToInstruction(new PublicKey(env.assets[0]!.mint),source,operator.publicKey,1000000000n,[],TOKEN_2022_PROGRAM_ID)]);
 }
 async use<T>(owner:string,fn:(runtime:DemoRuntime)=>Promise<T>){return this.serialized(async()=>{
  if(owner!==this.current.market.chain.env.judge.owner)throw new Error("Live session changed. Reconnect your wallet.");
  return fn(this.current);
 });}
 async reset(owner:string,keepSession=false){return this.use(owner,async runtime=>{
  const row=this.db.query("SELECT resets FROM guests WHERE owner=?").get(owner) as {resets:number}|null;
  if(row===null||row.resets>=5)throw new Error("This wallet has used its five demo resets. Recorded demo remains available.");
  await runtime.reset();this.db.query("UPDATE guests SET resets=resets+1 WHERE owner=?").run(owner);
  this.db.query("UPDATE active SET until_ms=? WHERE owner=?").run(keepSession?Date.now()+900000:0,owner);return {ready:true};
 });}
 async tick(){return this.serialized(async()=>{try{await this.current.tick();}catch(error){this.current.error(error);}});}
 close(){if(this.current!==this.base)this.current.market.chain.journal.close();this.db.close();}
}
