import {expect,test} from "bun:test";
import {DemoJournal} from "../../src/_adapters/_0_solana/_7_demo/_1_journal/mod";
import {DemoRuntime} from "../../src/_adapters/_0_solana/_7_demo/_4_runtime/mod";
import type {DemoMarket} from "../../src/_adapters/_0_solana/_7_demo/_3_controls/_0_market/mod";
import {policyFixture} from "../../src/_kernel/_test/mod";
test("reset requires wallet expiry and a post-expiry finalized policy read",async()=>{
 const journal=new DemoJournal(":memory:");let height=123,reads=0,restore=0,appears=false;
 const state=journal.read();state.policy=policyFixture();journal.save(state);
 journal.issue({run:1,kind:"authorize",message:"packet",height:123});
 const market={chain:{journal,rpc:{getBlockHeight:async(commitment:string)=>{expect(commitment).toBe("finalized");return height;}}},
 native:async(_policy:unknown,_digest:unknown,commitment:string)=>{expect(commitment).toBe("finalized");reads++;return appears&&reads%2===0?"active":"absent";}} as unknown as DemoMarket;
 const runtime=new DemoRuntime(market);runtime.actions.restore=async()=>{restore++;};
 try{
  await expect(runtime.reset()).rejects.toThrow("blockhash");expect(restore).toBe(0);expect(journal.issued()).not.toBeNull();
  height=124;reads=0;appears=true;
  await expect(runtime.reset()).rejects.toThrow("revoke");expect(restore).toBe(0);expect(journal.issued()).not.toBeNull();
  reads=0;appears=false;await runtime.reset();expect(reads).toBe(2);expect(restore).toBe(1);expect(journal.read().run).toBe(2);
 }finally{journal.close();}
});
