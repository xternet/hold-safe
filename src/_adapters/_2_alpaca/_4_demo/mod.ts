import type {DemoReferencePort,DemoReferenceView,PriceObservation,ReferenceFeed,Subscription} from "../../../_kernel/mod";

type Calendar={start():Promise<void>;stop():Promise<void>;session(at:number):"regular"|"closed"|"unknown"};
export class DemoReference implements DemoReferencePort {
  private latest:PriceObservation|null=null;
  private subscription:Subscription|null=null;
  private reason="Waiting for an AAPL IEX quote";
  constructor(private readonly feed:ReferenceFeed,private readonly calendar:Calendar,private readonly now=Date.now) {
    if(feed.id!=="alpaca-iex")throw new Error("Demo reference requires explicit IEX feed");
  }
  async start() {
    if(this.subscription!==null)throw new Error("Reference already started");
    await this.calendar.start();
    const result=await this.feed.subscribe("AAPL",event=>{
      if(!event.ok){this.latest=null;this.reason=event.error.message;return;}
      const p=event.value;
      if(p.provider!=="alpaca-iex"||p.instrument!=="AAPL"||p.coverage!=="venue"||p.session!=="regular"||
        p.bidUsd.n<=0n||p.bidUsd.d<=0n||p.askUsd.n<=0n||p.askUsd.d<=0n){
        this.latest=null;this.reason="Unexpected reference identity or quote";
        console.error(JSON.stringify({phase:"demo-reference",reason:this.reason}));return;
      }
      this.latest=p;this.reason="Fresh AAPL quote from IEX only";
    });
    if(!result.ok){this.reason=result.error.message;return;}
    this.subscription=result.value;
  }
  read():DemoReferenceView {
    const now=this.now(),session=this.calendar.session(now),p=this.latest,health=this.feed.health();
    const valid=p!==null&&p.sourceAtMs<=now&&now-p.sourceAtMs<5000&&p.receivedAtMs<=now&&now-p.receivedAtMs<5000;
    const status=session==="closed"?"closed":session==="unknown"||p===null?"unavailable":!valid?"stale":health.healthy?"live":"unavailable";
    const price=(value:{n:bigint;d:bigint})=>{const scaled=value.n*10000n/value.d;return `${scaled/10000n}.${(scaled%10000n).toString().padStart(4,"0")}`;};
    return {provider:"alpaca-iex",instrument:"AAPL",coverage:"venue",status,bidUsd:status==="live"?price(p!.bidUsd):null,
      askUsd:status==="live"?price(p!.askUsd):null,sourceAtMs:p===null?null:p.sourceAtMs,checkedAtMs:now,
      reason:session!=="regular"?`Stock session ${session}`:status==="stale"?"No fresh quote within five seconds":valid&&!health.healthy?health.reason:this.reason};
  }
  async stop(){if(this.subscription!==null)await this.subscription.stop();this.subscription=null;this.latest=null;await this.calendar.stop();}
}
