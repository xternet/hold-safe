import {existsSync,unlinkSync} from "node:fs";
import { test, expect } from "bun:test";
import { DemoJournal } from "../../src/_adapters/_0_solana/_7_demo/_1_journal/mod";
import { policyFixture } from "../../src/_kernel/_test/mod";
test("demo history preserves policies and unresolved packets across reset attempts", () => {
 const db = new DemoJournal(":memory:");
 try {
  const state=db.read(); state.policy=policyFixture(); db.save(state);
  expect(()=>db.save({...state,policy:null})).toThrow("rewrite");
  db.prepare("test-signature","test-packet","exit",100);
  expect(()=>db.prepare("second","second","exit",101)).toThrow("Reconcile");
  expect(()=>db.save({...state,run:2,policy:null})).toThrow("pending");
  expect(db.pending()).toHaveLength(1); db.finish("test-signature","finalized");
  expect(db.pending()).toHaveLength(0); expect(db.history()).toHaveLength(1);
  db.save({...state,run:2,policy:null}); expect(db.read().run).toBe(2);
 } finally { db.close(); }
});

test("finalized receipt and packet status commit together",()=>{
 const journal=new DemoJournal(":memory:");
 try{
  journal.prepare("signature","packet","guard-exit",123);
  expect(()=>journal.finalize("signature","wrong-kind")).toThrow();
  expect(journal.pending()).toHaveLength(1);
  expect(journal.read().receipts).toHaveLength(0);
  journal.finalize("signature","guard-exit");
  expect(journal.pending()).toHaveLength(0);
  expect(journal.read().receipts).toEqual([{kind:"guard-exit",signature:"signature"}]);
  expect(()=>journal.finalize("signature","guard-exit")).toThrow();
 }finally{journal.close();}
});

test("owner packet survives restart and cannot reset before explicit expiry clearance",()=>{
 const path=`/tmp/solstock-issued-${crypto.randomUUID()}.sqlite`;
 let journal=new DemoJournal(path);
 try{
  const state=journal.read();state.policy=policyFixture();journal.save(state);
  journal.issue({message:"owner-message",height:123,kind:"authorize",run:state.run});
  journal.close();journal=new DemoJournal(path);
  expect(journal.issued()).toEqual({message:"owner-message",height:123,kind:"authorize",run:1});
  expect(()=>journal.save({...journal.read(),run:2,policy:null})).toThrow("wallet");
  journal.clearIssued();journal.save({...journal.read(),run:2,policy:null});
  expect(journal.issued()).toBeNull();expect(journal.read().run).toBe(2);
 }finally{journal.close();for(const suffix of ["","-wal","-shm"])if(existsSync(path+suffix))unlinkSync(path+suffix);}
});
