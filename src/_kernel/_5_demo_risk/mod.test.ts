import { test, expect } from "bun:test";
import { demoRisk, demoProtections, validateDemoProtections } from "./mod";
const sample = { now:10000, chainAt:10000, referenceAt:10000, quoteRaw:250000000n, referenceRaw:250000000n,
 supply:1000n, baselineSupply:1000n, frozen:false, previous:null };
test("demo requires sustained price/supply evidence and never claims a frozen-token exit",()=>{
 expect(demoRisk(sample).trigger).toBe(false);
 const price=demoRisk({...sample,quoteRaw:225000000n}); expect(price.trigger).toBe(false);
 expect(demoRisk({...sample,now:13000,chainAt:13000,referenceAt:13000,quoteRaw:225000000n,previous:price.next}).trigger).toBe(true);
 const mint=demoRisk({...sample,supply:1200n});
 expect(demoRisk({...sample,now:13000,chainAt:13000,referenceAt:13000,supply:1200n,previous:mint.next}).trigger).toBe(true);
 expect(demoRisk({...sample,frozen:true,previous:mint.next}).trigger).toBe(false);
 expect(demoRisk({...sample,now:16000,previous:price.next}).next).toBe(null);
 expect(demoRisk({...sample,now:13000,chainAt:10000,referenceAt:10000,quoteRaw:225000000n,previous:price.next}).trigger).toBe(false);
});

test("only selected demo protections can trigger across the full selection matrix",()=>{
 for(const priceDrop of [false,true])for(const supplySpike of [false,true]){
  if(!priceDrop&&!supplySpike)continue;
  const protections={priceDrop,supplySpike};
  for(const priceEvent of [false,true])for(const supplyEvent of [false,true]){
   const observation={...sample,protections,quoteRaw:priceEvent?225000000n:250000000n,supply:supplyEvent?1200n:1000n};
   const first=demoRisk(observation);
   const last=demoRisk({...observation,now:13000,chainAt:13000,referenceAt:13000,previous:first.next});
   expect(last.trigger).toBe((priceDrop&&priceEvent)||(supplySpike&&supplyEvent));
  }
 }
});

test("protection configuration rejects missing, empty, mistyped and unknown selections",()=>{
 for(const value of [null,{},[],{priceDrop:false,supplySpike:false},{priceDrop:true},{priceDrop:"true",supplySpike:false},{priceDrop:true,supplySpike:false,freeze:true}])
  expect(()=>validateDemoProtections(value)).toThrow();
 expect(validateDemoProtections({priceDrop:true,supplySpike:false})).toEqual({priceDrop:true,supplySpike:false});
});
test("legacy demo policies retain both triggers and new policies retain explicit selections",()=>{
 const rule={id:"demo-risk" as const,version:1 as const,thresholdBps:300,persistenceMs:3000,maxAgeMs:5000,maxSkewMs:2000,maxImpactBps:300,maxOutputDeviationBps:100,supplyBaselineRaw:"1000",referenceMode:"replay" as const};
 expect(demoProtections(rule)).toEqual({priceDrop:true,supplySpike:true});
 expect(demoProtections({...rule,version:2,protections:{priceDrop:false,supplySpike:true}})).toEqual({priceDrop:false,supplySpike:true});
});
