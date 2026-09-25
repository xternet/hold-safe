import {test,expect} from "bun:test";
import {demoEvidence,demoOutcome,demoComparison,demoProgress,type EvidenceView} from "./mod";
const sample:EvidenceView={state:{phase:"armed",scenario:"freeze",receipts:[{kind:"freeze",signature:"freeze-signature"}],policy:{amountRaw:"100000000",source:"source-account",input:{address:"mint-account"},rule:{id:"demo-risk",version:2,protections:{priceDrop:true,supplySpike:true},thresholdBps:300,persistenceMs:3000,maxAgeMs:5000,maxSkewMs:2000,maxImpactBps:300,maxOutputDeviationBps:100,supplyBaselineRaw:"100000000000",referenceMode:"replay"}}},balances:{frozen:true,supply:"100000000000"},balancesObservedAt:10000,observation:null};
test("freeze evidence links the actual receipt/account and never calls prevention an exit",()=>{
 const rows=demoEvidence(sample);
 expect(rows[0]!.href).toContain("freeze-signature?cluster=devnet");
 expect(rows[1]!.detail).toContain("Frozen = true");
 expect(rows[1]!.href).toContain("source-account?cluster=devnet");
 expect(rows[2]!.title).toBe("No exit transaction submitted");
 expect(rows[2]!.detail).toContain("cannot sell");
});
test("requested simulation without a receipt is not confirmed",()=>{
 const rows=demoEvidence({...sample,state:{...sample.state,receipts:[]}});
 expect(rows[0]!.title).toContain("awaiting confirmation");expect(rows[0]!.href).toBeUndefined();
});
test("price evidence derives values from observed quote and selected amount",()=>{
 const rows=demoEvidence({...sample,state:{...sample.state,scenario:"collapse",receipts:[{kind:"price-collapse",signature:"price-signature"}]},balances:{...sample.balances,frozen:false},observation:{quoteRaw:"225000000",at:10000}});
 expect(rows[1]!.detail).toContain("225.00 demoUSD");expect(rows[1]!.detail).toContain("250.00");expect(rows[1]!.detail).toContain("10.00%");
});
test("only a current-run confirmed exit receipt yields an exit link",()=>{
 const rows=demoEvidence({...sample,state:{...sample.state,phase:"exited",receipts:[...sample.state.receipts,{kind:"guard-exit",signature:"exit-signature"}]} });
 expect(rows[2]!.title).toBe("Exit confirmed on Devnet");expect(rows[2]!.href).toContain("exit-signature");
});

test("outcomes distinguish freeze detection, successful sale and pending simulation",()=>{
 expect(demoOutcome(sample).title).toBe("Freeze detected");
 expect(demoOutcome(sample).detail).toContain("could not be sold");
 expect(demoOutcome({...sample,state:{...sample.state,receipts:[]},balances:{...sample.balances,frozen:false}}).title).toBe("Test running");
 const exited={...sample,state:{...sample.state,phase:"exited",receipts:[...sample.state.receipts,{kind:"guard-exit",signature:"exit"}]}};
 expect(demoOutcome(exited).title).toBe("Exit successful");
 expect(demoOutcome({...exited,state:{...exited.state,receipts:[]}}).title).not.toBe("Exit successful");
});

test("stock/token comparison normalizes quote by selected amount and exposes missing/stale data",()=>{
 const half={...sample,state:{...sample.state,policy:{...sample.state.policy!,amountRaw:"50000000"}},observation:{quoteRaw:"112500000",at:10000}};
 expect(demoComparison(half,11000)).toMatchObject({stock:"250.00",token:"225.00",gap:"10.00%",stale:false});
 expect(demoComparison({...half,observation:{quoteRaw:"121250000",at:10000}},11000).gap).toBe("3.00%");
 expect(demoComparison(half,16000).stale).toBe(true);
 expect(demoComparison({...half,observation:null},11000).token).toBe("—");
 expect(demoComparison({...half,observation:null},11000).gap).toBe("—");
});

test("exit progress distinguishes risk checks from transaction finalization",()=>{
 const checking={...sample,balances:{...sample.balances,frozen:false},state:{...sample.state,scenario:"collapse",receipts:[{kind:"price-collapse",signature:"cause"}]}};
 expect(demoOutcome(checking)).toMatchObject({kind:"running",title:"Checking exit conditions"});
 expect(demoOutcome({...checking,history:[{kind:"guard-exit",status:"pending",signature:"pending"}]})).toMatchObject({kind:"running",title:"Confirming your exit"});
 expect(demoOutcome({...checking,history:[{kind:"guard-exit",status:"failed",signature:"failed"}]}).title).toBe("Exit needs attention");
});

test("previous-run exit history is not proof for an unconfirmed new event",()=>{
 const rows=demoEvidence({...sample,state:{...sample.state,receipts:[]},balances:{...sample.balances,frozen:false},history:[{kind:"guard-exit",status:"finalized",signature:"old-run"}]});
 expect(rows.some(row=>row.href?.includes("old-run"))).toBe(false);
});

test("progress advances only with observed receipts and preserves freeze limitation",()=>{
 const v={...sample,balances:{...sample.balances,frozen:false},state:{...sample.state,scenario:"collapse",receipts:[]}};
 expect(demoProgress(v).step).toBe(0);
 const event={...v,state:{...v.state,receipts:[{kind:"price-collapse",signature:"cause"}]}};
 expect(demoProgress(event).step).toBe(1);
 expect(demoProgress({...event,history:[{kind:"guard-exit",status:"pending",signature:"exit"}]}).step).toBe(2);
 const done={...event,state:{...event.state,phase:"exited",receipts:[...event.state.receipts,{kind:"guard-exit",signature:"exit"}]}};
 expect(demoProgress(done)).toMatchObject({step:3,finished:true});
 expect(demoProgress(sample).labels).toEqual(["Simulate","Check","Detected"]);
 expect(demoProgress(done,true)).toMatchObject({labels:["Reset","Ready"],step:0,finished:false});
});
