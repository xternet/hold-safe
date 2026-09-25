import type {DemoRiskRule} from "../../_kernel/mod";
export const isReplay=location.pathname==="/tmp/app/replay";
type Receipt={kind:string;signature:string};
type RecordCase={scenario:string;owner:string;recordedAt:string;amountRaw:string;proceedsRaw:string;baselineSupply:string;policy:{amountRaw:string;minimumOutputRaw:string;expiresAt:number;source:string;input:{address:string};rule:DemoRiskRule};before:{stockRaw:string;usdRaw:string};after:{stockRaw:string;usdRaw:string};receipts:Receipt[]};
let records:RecordCase[]=[],record:RecordCase,phase="ready",scenario="none",stage=0;
const el=(id:string)=>document.getElementById(id)!;
export async function connectReplay(){
 const response=await fetch("/tmp/app/replay.json");if(!response.ok)throw new Error("Recorded demo unavailable; please refresh.");
 records=(await response.json()).cases;const first=records.find(r=>r.scenario==="collapse");if(!first?.policy||!first.before||!first.after)throw new Error("Recorded wallet data is missing");record=first;
 return {publicKey:{toBase58:()=>record.owner},connect:async()=>{},signMessage:async():Promise<Uint8Array>=>{throw new Error("Replay does not sign messages");},signTransaction:async():Promise<never>=>{throw new Error("Replay does not sign transactions");}};
}
export function replayView(){
 if(!record)throw new Error("Start the recorded demo first");
 const receipts=record.receipts.filter(r=>r.kind==="authorize"?phase!=="ready":r.kind==="guard-exit"?stage===3:stage>=1&&scenario!=="none");
 const history=receipts.map(r=>({...r,status:"finalized"})).reverse();
 if(stage===2){const exit=record.receipts.find(r=>r.kind==="guard-exit");if(!exit)throw new Error("Missing recorded exit");history.unshift({...exit,status:"pending"});}
 return {busy:false,balances:{...(stage===3?record.after:record.before),frozen:false,supply:record.baselineSupply},balancesObservedAt:Date.parse(record.recordedAt),observation:null,state:{phase,scenario,reason:"Recorded Devnet run; no live monitoring or transactions",run:1,policy:phase==="ready"?null:record.policy,receipts},history};
}
export async function replayAction(path:string,body:Record<string,unknown>){
 if(path==="authorize"){phase="armed";return {};}
 if(path==="revoke"){phase="revoked";return {};}
 if(path==="reset"){phase="ready";scenario="none";stage=0;return {};}
 if(path==="scenario"){
  const selected=records.find(r=>r.scenario===body.kind);if(!selected)throw new Error("Recorded scenario unavailable");
  record=selected;scenario=selected.scenario;stage=0;
  for(const next of [1,2,3]){await new Promise(resolve=>setTimeout(resolve,1000));stage=next;if(stage===3)phase="exited";window.dispatchEvent(new Event("replay-progress"));}
  return {};
 }
 throw new Error("Operation unavailable in recorded mode");
}
export function decorateReplay(connected:boolean){
 document.body.classList.add("recorded-mode");
 const network=document.querySelector<HTMLElement>(".network");if(network)network.textContent="Recorded demo";
 el("network-setup").hidden=true;el("wallet-intro").hidden=false;
 el("wallet-intro").querySelector("h2")!.textContent="Try protection, step by step.";
 el("wallet-intro").querySelector("p")!.textContent="No wallet. No transactions.";
 el("wallet-intro").querySelector(".setup-note")!.textContent="Uses a recorded 1 demoAAPL example.";
 if(!connected)(el("authorize") as HTMLButtonElement).textContent="Start demo";
 const slider=el("amount") as HTMLInputElement;slider.min="100";slider.max="100";slider.value="100";slider.disabled=true;el("amount-max").textContent="1.00";el("stock").textContent="1.00";slider.parentElement?.classList.add("recorded-amount");
 for(const id of ["price-protection","supply-protection"]){const input=el(id) as HTMLInputElement;input.checked=true;input.disabled=true;}
 el("hint").textContent="Recorded settings · No signature required";
 el("reference").textContent="Recorded demo · No live market feed";
 el("portfolio").classList.remove("is-live");
 if(phase==="armed"){el("position-status").textContent="Recorded protection";el("active-title").textContent="Protection enabled";el("position-expiry").textContent="Historical authorization";}
 el("position-expiry").textContent=record?`Recorded ${new Date(record.recordedAt).toLocaleDateString()}`:"";
 document.querySelectorAll<HTMLElement>("[data-comparison]").forEach(e=>e.hidden=true);
 document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach(button=>{button.disabled=phase!=="armed"||scenario!=="none";});
 el("lab").hidden=!connected||phase==="ready"||phase==="revoked"||scenario!=="none";
 if(connected&&scenario!=="none"){
  el("result-detail").textContent=stage===3?`Recorded exit: ${(Number(record.proceedsRaw)/1e6).toFixed(2)} demoUSD received.`:"Replaying recorded confirmation steps…";
  const rows=el("evidence-steps").children;
  if(rows[1]){const description=rows[1].querySelector("p");if(description)description.textContent=scenario==="collapse"?"A controlled pool trade moved the token price below the synthetic stock reference.":"Controlled issuance triggered the recorded supply-change rule.";const title=rows[1].querySelector("strong");if(title)title.textContent="Recorded risk condition";}
 }
 const footer=document.querySelector("footer");if(footer)footer.textContent="Recorded Devnet demo · No new transactions";
}
