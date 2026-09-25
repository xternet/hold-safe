import {demoProtections,type DemoRiskRule} from "../../_kernel/mod";
export type EvidenceView={history?:{kind:string;status:string;signature:string}[];state:{phase:string;scenario:string;receipts:{kind:string;signature:string}[];policy:{amountRaw:string;source:string;input:{address:string};rule:DemoRiskRule}|null};balances:{frozen:boolean;supply:string};balancesObservedAt:number;observation:{quoteRaw:string;at:number}|null};
type EvidenceRow={title:string;detail:string;href?:string;link?:string};
const explorer=(kind:"tx"|"address",value:string)=>`https://explorer.solana.com/${kind}/${encodeURIComponent(value)}?cluster=devnet`;
function decimal(raw:bigint,scale:bigint){const sign=raw<0n?"−":"",n=raw<0n?-raw:raw;return `${sign}${n/scale}.${((n%scale)*100n/scale).toString().padStart(2,"0")}`;}
const time=(at:number)=>new Date(at).toLocaleTimeString();
export function demoEvidence(view:EvidenceView):EvidenceRow[]{
 const {state}=view,policy=state.policy;
 if(policy===null||state.scenario==="none")return [];
 const events:Record<string,{kind:string;title:string;detail:string}>={
  freeze:{kind:"freeze",title:"Token freeze confirmed",detail:"The demo issuer froze your demoAAPL token account."},
  mint:{kind:"mint-anomaly",title:"Supply increase confirmed",detail:"The demo issuer minted additional demoAAPL tokens."},
  collapse:{kind:"price-collapse",title:"Price-change trade confirmed",detail:"The demo executed a sell into the Devnet liquidity pool."},
 };
 const event=events[state.scenario];if(event===undefined)throw new Error("Unknown demo scenario");
 const cause=state.receipts.find(row=>row.kind===event.kind),exit=state.receipts.find(row=>row.kind==="guard-exit");
 const rows:EvidenceRow[]=[cause?{title:event.title,detail:event.detail,href:explorer("tx",cause.signature),link:"Verify simulation transaction ↗"}:{title:"Simulation awaiting confirmation",detail:"The event was requested. No finalized simulation receipt is available yet."}];
 const enabled=demoProtections(policy.rule);
 if(state.scenario==="freeze")rows.push({title:"Token account checked",detail:`Frozen = ${view.balances.frozen}. RPC observation at ${time(view.balancesObservedAt)}.`,href:explorer("address",policy.source),link:"Inspect token account ↗"});
 else if(state.scenario==="mint"){
  const baseline=BigInt(policy.rule.supplyBaselineRaw),supply=BigInt(view.balances.supply),increase=(supply-baseline)*10000n/baseline;
  rows.push({title:"Supply compared with your baseline",detail:`${decimal(baseline,100000000n)} → ${decimal(supply,100000000n)} tokens (${decimal(increase,100n)}% change). Trigger: over 10%, ${enabled.supplySpike?"enabled":"not selected"}. Read at ${time(view.balancesObservedAt)}.`,href:explorer("address",policy.input.address),link:"Inspect mint supply ↗"});
 }else if(view.observation!==null){
  const quote=BigInt(view.observation.quoteRaw),reference=BigInt(policy.amountRaw)*250n/100n,discount=(reference-quote)*10000n/reference;
  rows.push({title:"Executable quote compared with reference",detail:`${decimal(quote,1000000n)} demoUSD vs ${decimal(reference,1000000n)} synthetic reference: ${decimal(discount,100n)}% discount. Trigger: 3%, ${enabled.priceDrop?"enabled":"not selected"}. Quote at ${time(view.observation.at)}. This quote is calculated by the app.`});
 }else rows.push({title:"Waiting for a price observation",detail:"No executable quote has been recorded yet."});
 if(exit&&state.phase==="exited")rows.push({title:"Exit confirmed on Devnet",detail:`${decimal(BigInt(policy.amountRaw),100000000n)} demoAAPL exited. Open the transaction to verify token transfers and wallet balance changes.`,href:explorer("tx",exit.signature),link:"Verify exit & balance changes ↗"});
 else if(cause&&view.history?.[0]?.kind==="guard-exit")rows.push({title:`Exit transaction ${view.history[0].status}`,detail:"Success requires a finalized transaction and consumed guard authorization.",href:explorer("tx",view.history[0].signature),link:"Inspect exit transaction ↗"});
 else if(view.balances.frozen)rows.push({title:"No exit transaction submitted",detail:"The account is frozen, so the guard cannot sell these tokens. The monitor stopped before submitting a swap. This demonstrates a limitation, not a saved position."});
 else rows.push({title:"No confirmed exit yet",detail:"Selected price or supply conditions must persist for 3 seconds. An exit also needs a valid route and your minimum proceeds. The asset status shows the current result."});
 return rows;
}
export function demoOutcome(view:EvidenceView){
 const state=view.state,policy=state.policy,exit=state.receipts.find(row=>row.kind==="guard-exit");
 if(state.phase==="exited"&&exit&&policy)return {kind:"success",title:"Exit successful",detail:`${decimal(BigInt(policy.amountRaw),100000000n)} demoAAPL was sold. The proceeds are in your wallet.`};
 if(view.balances.frozen)return {kind:"detected",title:"Freeze detected",detail:"Detection worked. The frozen tokens could not be sold."};
 const kind=state.scenario==="collapse"?"price-collapse":state.scenario==="mint"?"mint-anomaly":"freeze";
 if(!state.receipts.some(row=>row.kind===kind))return {kind:"running",title:"Test running",detail:"Waiting for the simulation transaction to confirm on Devnet."};
 if(policy){
  const enabled=demoProtections(policy.rule);
  if((state.scenario==="collapse"&&!enabled.priceDrop)||(state.scenario==="mint"&&!enabled.supplySpike))return {kind:"neutral",title:"No exit — check not selected",detail:"The event happened, but you did not enable this exit condition."};
 }
 const latest=view.history?.[0];
 if(latest?.kind==="guard-exit"&&latest.status==="pending")return {kind:"running",title:"Confirming your exit",detail:"Exit transaction prepared. Waiting for Devnet finalization; your tokens are not confirmed sold yet."};
 if(latest?.kind==="guard-exit"&&(latest.status==="failed"||latest.status==="expired"))return {kind:"neutral",title:"Exit needs attention",detail:`The exit transaction ${latest.status}. Open proof to inspect the transaction; no sale is confirmed.`};
 return {kind:"running",title:"Checking exit conditions",detail:"Event confirmed. Checking the 3-second risk window and executable quote before submitting an exit."};
}
export function demoProgress(view:EvidenceView|null,resetting=false){
 if(resetting)return {labels:["Reset","Ready"],step:0,finished:false};
 const outcome=view===null?null:demoOutcome(view);
 if(outcome?.kind==="detected")return {labels:["Simulate","Check","Detected"],step:2,finished:true};
 if(outcome?.kind==="neutral")return {labels:["Simulate","Check",outcome.title==="Exit needs attention"?"Review":"No exit"],step:2,finished:true};
 const labels=["Simulate","Check","Confirm","Complete"];
 if(outcome?.kind==="success")return {labels,step:3,finished:true};
 const step=outcome?.title==="Confirming your exit"?2:outcome?.title==="Checking exit conditions"?1:0;
 return {labels,step,finished:false};
}
export function demoComparison(view:EvidenceView,now=Date.now()){
 const policy=view.state.policy,quote=view.observation;
 if(!policy||!quote)return {stock:"250.00",token:"—",gap:"—",stale:false,note:"Waiting for an executable quote"};
 const amount=BigInt(policy.amountRaw),reference=amount*250n/100n,output=BigInt(quote.quoteRaw);
 const stale=now-quote.at>=5000||quote.at>now;
 return {stock:decimal(reference*100000000n/amount,1000000n),token:decimal(output*100000000n/amount,1000000n),gap:`${decimal((reference-output)*10000n/reference,100n)}%`,stale,
  note:`${stale||view.state.phase!=="armed"?"Last":"Live"} Devnet quote · ${time(quote.at)} · 3% exit threshold`};
}
export function renderDemoEvidence(view:EvidenceView|null,connected:boolean,pending:string|null=null,resetting=false){
 const panel=document.getElementById("evidence"),list=document.getElementById("evidence-steps");
 if(!panel||!list)throw new Error("Missing simulation evidence panel");
 document.querySelectorAll<HTMLElement>("[data-comparison]").forEach(box=>{
  box.hidden=view===null||view.state.policy===null||(box.dataset.comparison==="result"&&view.state.scenario!=="collapse"&&pending!=="collapse");
  if(view===null)return;const comparison=demoComparison(view);
  for(const field of ["stock","token","gap","note"] as const){const target=box.querySelector(`[data-value=${field}]`);if(!target)throw new Error(`Missing comparison ${field}`);target.textContent=comparison[field];}
  box.dataset.stale=String(comparison.stale);
 });
 const rows=view===null?[]:demoEvidence(view);panel.hidden=!connected||(rows.length===0&&pending===null);
 const outcome=view===null?{kind:"running",title:"Test running",detail:"Starting the simulation on Devnet."}:demoOutcome(view);
 for(const [id,value] of [["result-title",outcome.title],["result-detail",outcome.detail],["result-icon",outcome.kind==="success"?"✓":outcome.kind==="running"?"…":"◉"]]){
  const element=document.getElementById(id!);if(!element)throw new Error(`Missing ${id}`);element.textContent=value!;
 }
 panel.dataset.outcome=outcome.kind;
 const progress=document.getElementById("test-progress");if(!progress)throw new Error("Missing test progress");
 const stage=demoProgress(view,resetting);
 progress.style.setProperty("--progress",`${(stage.finished?stage.step+1:stage.step)/stage.labels.length*100}%`);
 progress.replaceChildren(...stage.labels.map((label,index)=>{
  const item=document.createElement("li");item.textContent=label;
  item.dataset.state=index<stage.step||(stage.finished&&index===stage.step)?"done":index===stage.step?"active":"waiting";
  if(index===stage.step)item.setAttribute("aria-current","step");return item;
 }));
 const proof=document.getElementById("result-proof");if(!proof)throw new Error("Missing proof disclosure");proof.hidden=rows.length===0;
 list.replaceChildren(...rows.map(row=>{
  const li=document.createElement("li"),title=document.createElement("strong"),detail=document.createElement("p");
  title.textContent=row.title;detail.textContent=row.detail;li.append(title,detail);
  if(row.href){const a=document.createElement("a");a.href=row.href;a.textContent=row.link!;a.target="_blank";a.rel="noopener";li.append(a);}
  return li;
 }));
}
