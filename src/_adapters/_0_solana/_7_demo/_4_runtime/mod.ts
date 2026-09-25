import { PublicKey, Transaction, Message, ComputeBudgetProgram } from "@solana/web3.js";
import { demoRisk, demoProtections, validateDemoProtections, type DemoPersistence } from "../../../../_kernel/_5_demo_risk/mod";
import { executeInstruction } from "../../_shared/_2_codec/_0_instructions/mod";
import { DemoActions } from "../_3_controls/_1_actions/mod";
import type { DemoMarket } from "../_3_controls/_0_market/mod";

export function verifyOwnerPacket(raw: string, expected: string, owner: string) {
  if (raw.length > 2200) throw new Error("Oversized transaction");
  const tx=Transaction.from(Buffer.from(raw,"base64"));
  if (tx.serializeMessage().toString("base64")!==expected || tx.feePayer?.toBase58()!==owner || !tx.verifySignatures()) throw new Error("Transaction differs from reviewed owner authorization");
  return tx;
}
export class DemoRuntime {
  busy=false;
  private lock:Promise<void>=Promise.resolve();
  private persistence:DemoPersistence|null=null;
  readonly actions:DemoActions;
  observation: { quoteRaw:string; at:number } | null=null;
  constructor(readonly market:DemoMarket) { this.actions=new DemoActions(market); }
  async exclusive<T>(fn:()=>Promise<T>) {
    const previous=this.lock;let release!:()=>void;
    this.lock=new Promise<void>(resolve=>{release=resolve;});
    await previous;this.busy=true;
    try{return await fn();}finally{this.busy=false;release();}
  }
  async prepare(kind:"authorize"|"revoke",amountRaw="100000000",protections:unknown={priceDrop:true,supplySpike:true}) {
    return this.exclusive(async()=>{
      const {chain}=this.market, state=chain.journal.read();
      if(chain.journal.pending().length)throw new Error("A transaction is still pending");
      let instructions;
      if(kind==="authorize") {
        if(state.policy!==null)return this.retryAuthorization(amountRaw,protections);
        const prepared=await this.market.prepare("replay",amountRaw,protections);
        Object.assign(state,{policy:prepared.policy,digest:prepared.digest,baselineSupply:prepared.supply,phase:"awaiting-signature",reason:"Review and sign in Solflare"});
        instructions=prepared.instructions;chain.journal.save(state);
      }else{
        if(state.policy===null||await this.market.native(state.policy,state.digest)!=="active")throw new Error("No active authorization to revoke");
        instructions=this.market.revoke(state.policy);
      }
      const {transaction,block}=await chain.unsigned(instructions,new PublicKey(chain.env.judge.owner));
      chain.journal.issue({message:transaction.serializeMessage().toString("base64"),height:block.lastValidBlockHeight,kind,run:state.run});
      return {transaction:transaction.serialize({requireAllSignatures:false}).toString("base64"),policy:state.policy};
    });
  }
  private async retryAuthorization(amountRaw:string,protections:unknown){
    const {chain}=this.market,state=chain.journal.read(),policy=state.policy,issued=chain.journal.issued();
    if(state.phase!=="awaiting-signature"||policy===null||issued===null||issued.kind!=="authorize"||issued.run!==state.run)throw new Error("Reset before creating a new authorization");
    if(policy.rule.id!=="demo-risk")throw new Error("Unexpected demo rule");
    const requested=validateDemoProtections(protections),original=demoProtections(policy.rule);
    if(amountRaw!==policy.amountRaw||requested.priceDrop!==original.priceDrop||requested.supplySpike!==original.supplySpike)throw new Error("Retry must use the same amount and protections; reset to change them");
    if(policy.expiresAt<=Date.now()/1000)throw new Error("Protection expired; reset the demo");
    if(await this.market.native(policy,state.digest,"confirmed")!=="absent")throw new Error("Authorization is already active or completed; refresh before retrying");
    let transaction=Transaction.populate(Message.from(Buffer.from(issued.message,"base64")));
    if(await chain.rpc.getBlockHeight("finalized")>issued.height){
      const renewed=await chain.unsigned(transaction.instructions,new PublicKey(policy.owner));transaction=renewed.transaction;
      chain.journal.issue({...issued,message:transaction.serializeMessage().toString("base64"),height:renewed.block.lastValidBlockHeight});
    }
    return {transaction:transaction.serialize({requireAllSignatures:false}).toString("base64"),policy};
  }
  async submit(raw:string) {
    return this.exclusive(async()=>{
      const {chain}=this.market,issued=chain.journal.issued();
      if(issued===null||issued.run!==chain.journal.read().run)throw new Error("Prepare a transaction first");
      const tx=verifyOwnerPacket(raw,issued.message,chain.env.judge.owner);
      const signature=await chain.submit(issued.kind,tx,issued.height);
      chain.journal.clearIssued();
      await this.refreshNative();return {signature};
    });
  }
  async scenario(kind:"collapse"|"mint"|"freeze") {
    return this.exclusive(async()=>{
      const journal=this.market.chain.journal,state=journal.read();
      if(state.phase!=="armed"||state.scenario!=="none")throw new Error("Arm a fresh run before selecting one scenario");
      state.scenario=kind;state.reason=`Applying controlled ${kind} scenario`;journal.save(state);
      return {signature:await this.actions.scenario(kind)};
    });
  }
  async reset() {
    return this.exclusive(async()=>{
      const {chain}=this.market,state=chain.journal.read();
      if(chain.journal.pending().length)throw new Error("Wait for pending transaction reconciliation");
      const native=state.policy===null?"absent":await this.market.native(state.policy,state.digest,"finalized");
      if(native==="active")throw new Error("Revoke the active policy in Solflare before resetting");
      const issued=chain.journal.issued();
      if(issued!==null&&native==="absent"&&await chain.rpc.getBlockHeight("finalized")<=issued.height)
        throw new Error("Wallet approval may still complete. Wait for its blockhash to expire before reset.");
      if(issued!==null&&native==="absent"&&state.policy!==null&&await this.market.native(state.policy,state.digest,"finalized")==="active")
        throw new Error("Wallet approval finalized; revoke it before resetting");
      chain.journal.clearIssued();
      await this.actions.restore();this.persistence=null;this.observation=null;
      chain.journal.save({run:state.run+1,phase:"ready",scenario:"none",policy:null,digest:"",baselineSupply:"",reason:"Fresh run ready; previous receipts retained",receipts:[],mode:"replay"});
      return {ready:true};
    });
  }
  private async refreshNative() {
    const journal=this.market.chain.journal,state=journal.read();if(state.policy===null)return;
    const native=await this.market.native(state.policy,state.digest);
    if(native==="absent")return;
    state.phase=native==="active"?"armed":native==="consumed"?"exited":"revoked";
    if(native==="consumed")state.reason="Onchain guard confirms this authorization was consumed by an atomic bounded exit";
    journal.save(state);
  }
  async tick() {
    if(this.busy)return;
    await this.exclusive(async()=>{
      const {chain}=this.market;
      if(chain.journal.pending().length){await chain.reconcile();if(chain.journal.pending().length)return;}
      await this.refreshNative();const state=chain.journal.read();
      if(state.phase!=="armed"||state.policy===null)return;
      const balances=await this.market.balances();
      if(balances.frozen){this.persistence=null;state.reason="Token frozen: exit unavailable. Thaw the demo fixture, then revoke and reset.";chain.journal.save(state);return;}
      const quote=await this.market.quote(state.policy),now=Date.now();this.observation={quoteRaw:quote.outputRaw,at:quote.sourceAtMs};
      if(state.policy.rule.id!=="demo-risk")throw new Error("Unexpected demo rule");
      const risk=demoRisk({protections:demoProtections(state.policy.rule),now,chainAt:quote.sourceAtMs,referenceAt:now,quoteRaw:BigInt(quote.outputRaw),referenceRaw:BigInt(state.policy.amountRaw)*250n/100n,
        supply:BigInt(balances.supply),baselineSupply:BigInt(state.baselineSupply),frozen:false,previous:this.persistence});
      this.persistence=risk.next;state.reason=risk.reason;chain.journal.save(state);
      if(!risk.trigger)return;
      await chain.send("guard-exit",[ComputeBudgetProgram.setComputeUnitLimit({units:600000}),executeInstruction(state.policy,quote)]);
      await this.refreshNative();
      if(chain.journal.read().phase!=="exited")throw new Error("Finalized transaction lacks consumed guard state");
      const after=await this.market.balances();
      if(BigInt(balances.stockRaw)-BigInt(after.stockRaw)!==BigInt(state.policy.amountRaw)||BigInt(after.usdRaw)-BigInt(balances.usdRaw)<BigInt(state.policy.minimumOutputRaw))throw new Error("Exit balance proof failed");
    });
  }
  error(error:unknown) {
    this.persistence=null;const reason=error instanceof Error?error.message:String(error);
    console.error(JSON.stringify({phase:"demo",reason}));
    const state=this.market.chain.journal.read();state.reason=reason;this.market.chain.journal.save(state);
  }
}
