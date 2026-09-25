import {expect,test} from "bun:test";
import {ComputeBudgetProgram,PublicKey,SystemProgram,Transaction} from "@solana/web3.js";
import {createAssociatedTokenAccountIdempotentInstruction} from "@solana/spl-token";
import {validateDemoTransaction} from "../../src/_adapters/_0_solana/_4_wallet/mod";
import {authorizeInstruction} from "../../src/_adapters/_0_solana/_shared/_2_codec/_0_instructions/mod";
import {policyAddress,stagingAddress} from "../../src/_adapters/_0_solana/_shared/_2_codec/_shared/mod";
import {policyDigest,validatePolicy} from "../../src/_kernel/mod";
import {DemoChain} from "../../src/_adapters/_0_solana/_7_demo/_2_chain/mod";
import {DemoMarket} from "../../src/_adapters/_0_solana/_7_demo/_3_controls/_0_market/mod";
// Optional live conformance runs against the owned free Devnet fixture only.
test.skipIf(process.env.SOLSTOCK_LIVE_DEMO!=="1")("demo browser reconstructs real owner packet and rejects wider bounds and added transfers",async()=>{
 const c=await DemoChain.open("/srv/cold/solstock-guard/m01-20260923-01/devnet-environment.json");
 try{
 const m=await DemoMarket.open(c);
 for(const amount of ["0","9999999","1000000001","-1","1.5","garbage"])await expect(m.prepare("replay",amount)).rejects.toThrow("Choose");
 for(const amount of ["101000000","500000000","1000000000"]){
  const full=await m.prepare("replay",amount);expect(full.policy.amountRaw).toBe(amount);
  const packet=await c.unsigned(full.instructions,new PublicKey(full.policy.owner));
  const raw=packet.transaction.serialize({requireAllSignatures:false}).toString("base64");
  expect(await validateDemoTransaction(raw,full.policy,full.policy.owner,"authorize")).toBeInstanceOf(Transaction);
  await expect(validateDemoTransaction(raw,{...full.policy,amountRaw:"1000000001"},full.policy.owner,"authorize")).rejects.toThrow("bounds");
 }
 const prepared=await m.prepare("replay","50000000",{priceDrop:false,supplySpike:true}),{policy}=prepared;
 expect(policy.rule.version).toBe(2);
 expect(()=>validatePolicy(policy,m.catalog,Math.floor(Date.now()/1000))).not.toThrow();
 for(const protections of [null,{}, {priceDrop:false,supplySpike:false}])await expect(m.prepare("replay","50000000",protections)).rejects.toThrow();
 expect(policy.amountRaw).toBe("50000000");
 expect(policy.minimumOutputRaw).toBe("87500000");
 const {transaction:tx}=await c.unsigned(prepared.instructions,new PublicKey(policy.owner));
 const raw=()=>tx.serialize({requireAllSignatures:false}).toString("base64");
 expect(await validateDemoTransaction(raw(),policy,policy.owner,"authorize")).toBeInstanceOf(Transaction);
 for(const change of [{amountRaw:"200000000"},{minimumOutputRaw:"1"},{recipient:policy.source},{expiresAt:policy.expiresAt+10000}])
  await expect(validateDemoTransaction(raw(),{...policy,...change},policy.owner,"authorize")).rejects.toThrow();
 if(policy.rule.id!=="demo-risk"||policy.rule.version!==2)throw new Error("Expected selection rule");
 const altered={...policy,rule:{...policy.rule,protections:{priceDrop:true,supplySpike:false}}};
 expect(await policyDigest(altered)).not.toBe(await policyDigest(policy));
 await expect(validateDemoTransaction(raw(),altered,policy.owner,"authorize")).rejects.toThrow();
 tx.add(SystemProgram.transfer({fromPubkey:new PublicKey(policy.owner),toPubkey:new PublicKey(policy.keeper),lamports:1}));
 await expect(validateDemoTransaction(raw(),policy,policy.owner,"authorize")).rejects.toThrow();
 const changed={...policy,minimumOutputRaw:"1"};
 const malicious=new Transaction({feePayer:new PublicKey(policy.owner),recentBlockhash:tx.recentBlockhash}).add(...prepared.instructions.slice(0,3),authorizeInstruction(changed,await policyDigest(changed),(await m.quote(policy)).routeKeys,true));
 await expect(validateDemoTransaction(malicious.serialize({requireAllSignatures:false}).toString("base64"),policy,policy.owner,"authorize")).rejects.toThrow();
 }finally{c.journal.close();}
},30000);
