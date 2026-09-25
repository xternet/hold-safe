import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import { unpackAccount, unpackMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { policyDigest, validateCatalog, validateDemoProtections, type Catalog, type Policy, type PriceObservation, type Subscription } from "../../../../../_kernel/mod";
import { LiveStateReader } from "../../../_venues/_0_raydium/_1_state/_1_read/mod";
import { quoteNativeState } from "../../../_venues/_0_raydium/_0_math/mod";
import { DEVNET, DEMO_GUARD } from "../../../_shared/mod";
import { policyAddress, stagingAddress } from "../../../_shared/_2_codec/_shared/mod";
import { decodePolicy, assertPolicyBinding } from "../../../_shared/_2_codec/_1_state/mod";
import { authorizeInstruction, revokeInstruction } from "../../../_shared/_2_codec/_0_instructions/mod";
import type { DemoChain } from "../../_2_chain/mod";
export class DemoMarket {
  readonly reader: LiveStateReader;
  private constructor(readonly chain: DemoChain, readonly catalog: Catalog) { this.reader = new LiveStateReader(chain.rpc, Date.now, DEVNET); }
  static async open(chain: DemoChain) {
    const raw: Catalog = JSON.parse(await readFile("config/coverage.json","utf8")), env=chain.env;
    const domain={namespace:"solana",reference:DEVNET}, evidence=createHash("sha256").update(JSON.stringify(env)).digest("hex");
    raw.chains[0]!.chain=domain;
    raw.feeds=[{id:"alpaca-iex",instruments:["AAPL"],coverage:"venue"},{id:"demo-usd",instruments:["DEMO/USD"],coverage:"venue"}];
    raw.assets.forEach((a,i)=>{ const native=env.assets[i]!; a.ref={chain:domain,address:native.mint};a.symbol=native.symbol;a.decimals=native.decimals;a.evidenceHash=evidence;
      a.reference={provider:i===0?"alpaca-iex":"demo-usd",instrument:i===0?"AAPL":"DEMO/USD",currency:"USD",coverage:"venue"}; });
    const route=raw.routes[0]!;route.chain=domain;route.input=raw.assets[0]!.ref;route.output=raw.assets[1]!.ref;route.id="raydium-clmm:demoAAPL-demoUSD:v1";
    route.pool=env.pool.address;route.program=env.pool.dex;route.programVersion=await chain.programVersion();route.evidenceHash=evidence;
    return new DemoMarket(chain,validateCatalog(raw));
  }
  async balances() {
    const {env,rpc}=this.chain;
    const keys=[env.judge.source,env.judge.recipient,env.assets[0]!.mint,env.judge.owner].map(k=>new PublicKey(k));
    const accounts=await rpc.getMultipleAccountsInfo(keys,"confirmed");
    if(accounts.some(a=>a===null))throw new Error("Judge fixture account missing");
    const source=unpackAccount(keys[0]!,accounts[0]!,TOKEN_2022_PROGRAM_ID),output=unpackAccount(keys[1]!,accounts[1]!,TOKEN_PROGRAM_ID);
    const mint=unpackMint(keys[2]!,accounts[2]!,TOKEN_2022_PROGRAM_ID),sol=accounts[3]!.lamports;
    if(source.owner.toBase58()!==env.judge.owner||source.mint.toBase58()!==env.assets[0]!.mint)throw new Error("Judge fixture identity mismatch");
    return {stockRaw:source.amount.toString(),usdRaw:output.amount.toString(),supply:mint.supply.toString(),frozen:source.isFrozen,solLamports:sol};
  }
  async prepare(mode:"replay"|"live",amountRaw="100000000",protections:unknown={priceDrop:true,supplySpike:true}) {
    const enabled=validateDemoProtections(protections);
    if(!/^[1-9][0-9]*$/.test(amountRaw)||BigInt(amountRaw)<10000000n||BigInt(amountRaw)>1000000000n)throw new Error("Choose 0.1–10 demoAAPL");
    const {env}=this.chain, route=this.catalog.routes[0]!, input=this.catalog.assets[0]!,output=this.catalog.assets[1]!, balances=await this.balances();
    if(balances.frozen||BigInt(balances.stockRaw)<BigInt(amountRaw))throw new Error("Reset/fund the judge wallet before arming");
    const policy:Policy={schema:1,chain:route.chain,orderId:randomBytes(32).toString("hex"),owner:env.judge.owner,keeper:env.operator,source:env.judge.source,
      input:input.ref,output:output.ref,amountRaw,recipient:env.judge.recipient,minimumOutputRaw:(BigInt(amountRaw)*175n/100n).toString(),slippageBps:100,
      expiresAt:Math.floor(Date.now()/1000)+900,guard:env.guard,guardVersion:route.guardVersion,routeId:route.id,
      rule:{id:"demo-risk",version:2,protections:enabled,thresholdBps:300,persistenceMs:3000,maxAgeMs:5000,maxSkewMs:2000,maxImpactBps:300,maxOutputDeviationBps:100,supplyBaselineRaw:balances.supply,referenceMode:mode},
      coverage:{inputProfile:input.profile,outputProfile:output.profile,inputReference:input.reference,outputReference:output.reference,
        venue:route.venue,pool:route.pool,program:route.program,programVersion:route.programVersion}};
    const quote=await this.quote(policy),digest=await policyDigest(policy),owner=new PublicKey(policy.owner);
    const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:600000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0}),
      createAssociatedTokenAccountIdempotentInstruction(owner,stagingAddress(policy),policyAddress(policy),new PublicKey(policy.input.address),TOKEN_2022_PROGRAM_ID),
      authorizeInstruction(policy,digest,quote.routeKeys,true)];
    return {policy,digest,instructions,supply:balances.supply};
  }
  async quote(policy:Policy) { return quoteNativeState(policy,this.catalog,await this.reader.read(policy)); }
  async native(policy:Policy,digest:string,commitment:"confirmed"|"finalized"="confirmed") {
    const minContextSlot=await this.chain.rpc.getSlot(commitment);
    const account=await this.chain.rpc.getAccountInfo(policyAddress(policy),{commitment,minContextSlot});if(account===null)return "absent";
    const value=decodePolicy(account,policyAddress(policy),DEMO_GUARD);assertPolicyBinding(policy,digest,value);return value.state;
  }
  revoke(policy:Policy) { return [ComputeBudgetProgram.setComputeUnitLimit({units:100000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0}),revokeInstruction(policy)]; }
}
