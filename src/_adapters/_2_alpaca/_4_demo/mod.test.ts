import {expect,test} from "bun:test";
import type {Observer,PriceObservation,ReferenceFeed} from "../../../_kernel/mod";
import {DemoReference} from "./mod";
test("IEX display uses one subscription, expires quotes and clears prices on closed session or errors",async()=>{
 let now=10000,session:"regular"|"closed"|"unknown"="regular",observer:Observer<PriceObservation>|undefined,count=0,stopped=0,healthy=true;
 const feed:ReferenceFeed={id:"alpaca-iex",health:()=>({source:"alpaca-iex",healthy,checkedAt:now,reason:"fixture"}),
 subscribe:async(symbol,watch)=>{expect(symbol).toBe("AAPL");count++;observer=watch;return {ok:true,value:{stop:async()=>{stopped++;}}};}};
 const calendar={start:async()=>{},stop:async()=>{stopped++;},session:()=>session};
 const ref=new DemoReference(feed,calendar,()=>now);
 await ref.start();expect(count).toBe(1);expect(ref.read().bidUsd).toBeNull();
 const quote:PriceObservation={id:"one",provider:"alpaca-iex",instrument:"AAPL",coverage:"venue",bidUsd:{n:2501234n,d:10000n},askUsd:{n:2502n,d:10n},
 bidSize:{n:1n,d:1n},askSize:{n:1n,d:1n},sizeUnit:"round_lots",sourceAtMs:now,receivedAtMs:now,session:"regular"};
 observer!({ok:true,value:quote});expect(ref.read().bidUsd).toBe("250.1234");expect(ref.read().status).toBe("live");
 healthy=false;expect(ref.read().status).toBe("unavailable");expect(ref.read().bidUsd).toBeNull();healthy=true;
 now+=5000;expect(ref.read().status).toBe("stale");expect(ref.read().bidUsd).toBeNull();
 session="closed";expect(ref.read().status).toBe("closed");
 session="unknown";expect(ref.read().status).toBe("unavailable");expect(ref.read().bidUsd).toBeNull();
 session="regular";observer!({ok:false,error:{code:"UNAVAILABLE",message:"connection lost",retryable:true,context:{provider:"alpaca-iex"}}});
 expect(ref.read().bidUsd).toBeNull();expect(ref.read().reason).toBe("connection lost");
 observer!({ok:true,value:{...quote,sourceAtMs:now,receivedAtMs:now,provider:"alpaca-sip"}});
 expect(ref.read().bidUsd).toBeNull();
 await ref.stop();expect(stopped).toBe(2);
});
