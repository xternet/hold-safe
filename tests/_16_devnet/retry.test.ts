import {expect,test} from "bun:test";
import {PublicKey,SystemProgram,Transaction} from "@solana/web3.js";
import {DemoJournal} from "../../src/_adapters/_0_solana/_7_demo/_1_journal/mod";
import {DemoRuntime} from "../../src/_adapters/_0_solana/_7_demo/_4_runtime/mod";
import type {DemoMarket} from "../../src/_adapters/_0_solana/_7_demo/_3_controls/_0_market/mod";
import {policyFixture} from "../../src/_kernel/_test/mod";
test("rejected approval retries identical packet and renews only after expiry",async()=>{
 const journal=new DemoJournal(":memory:"),policy=policyFixture(),owner=SystemProgram.programId;policy.owner=owner.toBase58();let height=10,native="absent",renewals=0;
 policy.rule={id:"demo-risk",version:2,protections:{priceDrop:true,supplySpike:true},thresholdBps:300,persistenceMs:3000,maxAgeMs:5000,maxSkewMs:2000,maxImpactBps:300,maxOutputDeviationBps:100,supplyBaselineRaw:"100",referenceMode:"replay"};policy.expiresAt=Math.floor(Date.now()/1000)+3600;
 const tx=new Transaction({feePayer:owner,recentBlockhash:SystemProgram.programId.toBase58()}).add(SystemProgram.transfer({fromPubkey:owner,toPubkey:owner,lamports:0}));
 journal.save({...journal.read(),phase:"awaiting-signature",policy});journal.issue({message:tx.serializeMessage().toString("base64"),height:10,kind:"authorize",run:1});
 const market={chain:{journal,env:{judge:{owner:policy.owner}},rpc:{getBlockHeight:async()=>height},unsigned:async()=>{renewals++;return {transaction:tx,block:{lastValidBlockHeight:20}};}},native:async()=>native} as unknown as DemoMarket;
 const runtime=new DemoRuntime(market);try{
  const retried=await runtime.prepare("authorize",policy.amountRaw);expect(retried.transaction).toBe(tx.serialize({requireAllSignatures:false}).toString("base64"));expect(renewals).toBe(0);
  await expect(runtime.prepare("authorize","1")).rejects.toThrow("same");
  height=11;await runtime.prepare("authorize",policy.amountRaw);expect(renewals).toBe(1);expect(journal.issued()?.height).toBe(20);
  native="active";await expect(runtime.prepare("authorize",policy.amountRaw)).rejects.toThrow("active");
 }finally{journal.close();}
});
