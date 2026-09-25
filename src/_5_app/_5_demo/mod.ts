import { type Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { demoProtections, type DemoRiskRule } from "../../_kernel/mod";
import { validateDemoTransaction } from "../../_adapters/_0_solana/_4_wallet/mod";
import {renderDemoEvidence,demoOutcome} from "../_6_demo_evidence/mod";
import {resetAfterExpiry} from "../_7_demo_recovery/mod";
import {isReplay,connectReplay,replayView,replayAction,decorateReplay} from "../_9_replay/mod";
Object.assign(globalThis,{Buffer});
type Solflare={publicKey:{toBase58():string}|null;connect():Promise<void>;signMessage(message:Uint8Array,display:"utf8"):Promise<{signature:Uint8Array}|Uint8Array>;signTransaction(tx:Transaction):Promise<Transaction>};
type View={busy:boolean;balances:{stockRaw:string;usdRaw:string;frozen:boolean;supply:string};balancesObservedAt:number;observation:{quoteRaw:string;at:number}|null;state:{phase:string;scenario:string;reason:string;run:number;policy:{amountRaw:string;minimumOutputRaw:string;expiresAt:number;source:string;input:{address:string};rule:DemoRiskRule}|null;receipts:{kind:string;signature:string}[]};history:{kind:string;status:string;signature:string}[]};
const element=(id:string)=>{const el=document.getElementById(id);if(el===null)throw new Error(`Missing element ${id}`);return el;};
let token="",wallet:Solflare|null=null,view:View|null=null,working=false,networkReady=isReplay,signing=false,resetting=false,step="assets",testing:string|null=null;
async function api(path:string,body:object){
 if(isReplay)return replayAction(path,body as Record<string,unknown>);
 const response=await fetch(`/tmp/app/api/${path}`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body)})
  .catch(error=>{throw new Error("Connection interrupted. Check activity before retrying; your transaction may still complete.",{cause:error});});
 if(!response.headers.get("content-type")?.includes("application/json"))throw new Error("Connection interrupted. Check activity before retrying.");
 const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
function renderPortfolio(){
 const connected=wallet!==null;element("layout").classList.toggle("with-portfolio",connected);element("portfolio").hidden=!connected||view?.state.phase==="awaiting-signature";
 const policy=view?.state.policy,phase=view?.state.phase;
 element("position-expiry").parentElement!.hidden=policy==null;element("position-stock").parentElement!.parentElement!.hidden=policy==null;
 element("portfolio-empty").hidden=policy!=null;element("position").hidden=policy==null;
 element("protected-count").textContent="0 active";
 if(!policy||!view)return;
 const expired=policy.expiresAt*1000<=Date.now()&&phase==="armed",frozen=view.balances.frozen;
 const status=frozen&&phase==="armed"?"Blocked":expired?"Expired":phase==="armed"?"Monitoring":phase==="exited"?"Exited":phase==="revoked"?"Revoked":"Awaiting approval";
 element("protected-count").textContent=phase==="armed"&&!expired?"1 active":"0 active";
 element("position-amount").textContent=units(policy.amountRaw,8);
 element("position-status").textContent=status;element("position-status").dataset.state=frozen?"frozen":expired?"expired":phase;
 const protections=demoProtections(policy.rule),rules=[];
 if(protections.priceDrop)rules.push("Price gap ≥3%");if(protections.supplySpike)rules.push("Supply ↑ >10%");
 element("position-rules").replaceChildren(...rules.map(text=>{const chip=document.createElement("span");chip.className="chip";chip.textContent=text;return chip;}));
 element("position-expiry").textContent=`Expires ${new Date(policy.expiresAt*1000).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}`;
 element("position-floor").textContent=`Minimum ${units(policy.minimumOutputRaw,6)} demoUSD`;
 element("event-title").textContent=phase==="exited"?"Automatic exit confirmed":frozen?"Exit blocked · token frozen":expired?"Protection expired":phase!=="armed"?status:view.state.scenario==="collapse"?"Price divergence simulated":view.state.scenario==="mint"?"Supply anomaly simulated":"";
 const live=phase==="armed"&&!frozen&&!expired&&view.observation!==null&&Date.now()-view.observation.at<10000;
 element("portfolio").classList.toggle("is-live",live);element("event-detail").parentElement!.parentElement!.hidden=phase==="armed"&&view.state.scenario==="none"&&!frozen&&!expired;
 element("event-detail").hidden=false;
 element("event-detail").textContent=phase==="exited"?`${units(policy.amountRaw,8)} demoAAPL sold. Proceeds are in your wallet.`:phase==="armed"&&view.state.scenario==="none"?(view.observation?`${live?"Live":"Last"} quote · ${new Date(view.observation.at).toLocaleTimeString()} · Supply checked ${new Date(view.balancesObservedAt).toLocaleTimeString()}`:"Waiting for first quote"):view.state.reason;
 const exit=view.state.receipts.find(row=>row.kind==="guard-exit"),link=element("exit-link") as HTMLAnchorElement;
 link.hidden=phase!=="exited"||exit===undefined;if(exit)link.href=`https://explorer.solana.com/tx/${encodeURIComponent(exit.signature)}?cluster=devnet`;
 element("position-stock").textContent=units(view.balances.stockRaw,8);element("position-usd").textContent=units(view.balances.usdRaw,6);
}
function render(){
 if(signing)return;
 renderPortfolio();renderDemoEvidence(view,wallet!==null,testing,resetting);
 const connected=wallet!==null,phase=view?.state.phase,frozen=view?.balances.frozen===true;
 const busy=working;
 const approvalExpired=phase==="awaiting-signature"&&view?.history[0]?.kind==="authorize"&&view.history[0].status==="expired";
 const tested=connected&&(testing!==null||(view!==null&&view.state.scenario!=="none"));element("layout").classList.toggle("test-result",tested);
 const retry=element("test-again") as HTMLButtonElement;retry.disabled=busy;retry.textContent=resetting?"Resetting demo…":"Test another event";
 element("layout").classList.toggle("monitoring",connected&&phase==="armed"&&!frozen);
 const label=!connected?"Not connected":frozen?"Frozen":phase==="armed"?"Protected":phase==="exited"?"Exited":phase==="awaiting-signature"?(approvalExpired?"Approval expired":"Awaiting approval"):"Not protected";
 element("phase").textContent=label;element("phase").dataset.state=frozen?"frozen":phase;
 const ready=phase==="ready",setup=connected&&ready&&step==="setup",choosing=connected&&ready&&step==="protections",selecting=connected&&ready&&step==="assets";
 element("network-setup").hidden=networkReady;element("wallet-intro").hidden=!networkReady;
 element("welcome").hidden=connected;element("assets").hidden=!selecting;element("setup").hidden=!setup;element("protections").hidden=!choosing;element("active").hidden=!connected||ready;
 element("step").textContent=!connected?(networkReady?"1 of 4":"Before you start"):ready?(choosing?"4 of 4":setup?"3 of 4":"2 of 4"):"Your protection";
 element("back").hidden=!setup&&!choosing;(element("back") as HTMLButtonElement).disabled=busy;element("lab").hidden=!connected||ready||phase==="awaiting-signature"||view?.state.scenario!=="none";
 element("details").hidden=!connected;element("activity").hidden=!connected||view?.history.length===0;
 const canTest=connected&&phase==="armed"&&!frozen&&view?.state.scenario==="none"&&!!view.state.policy&&view.state.policy.expiresAt*1000>Date.now();
 element("lab").classList.toggle("next-action",canTest&&!busy);
 const reset=element("reset-demo") as HTMLButtonElement;reset.disabled=busy;reset.textContent="↺ Reset demo";
 document.querySelectorAll<HTMLInputElement>("#amount,#price-protection,#supply-protection").forEach(input=>{input.disabled=busy;});
 const slider=element("amount") as HTMLInputElement;
 if(view){slider.max=String(Math.max(10,Math.min(1000,Number(BigInt(view.balances.stockRaw)/1000000n))));if(Number(slider.value)>Number(slider.max))slider.value=slider.max;}
 updateAmount();
 element("active-title").textContent=frozen?"Token frozen":phase==="exited"?"Exit complete":phase==="armed"?"You're protected":approvalExpired?"Approval expired":"Approve in Solflare";
 element("active-copy").textContent=frozen?"An exit is blocked. Reset to try again.":phase==="armed"?`${view?.state.policy?units(view.state.policy.amountRaw,8):""} demoAAPL · Automatic exit on`:phase==="exited"?"Proceeds are in your wallet.":approvalExpired?"The transaction expired. Start a fresh approval.":"Approval not completed. Retry in Solflare, or reset to start again.";
 const asset=element("asset") as HTMLButtonElement;asset.disabled=busy||!view||BigInt(view.balances.stockRaw)<10000000n;
 element("empty").hidden=!view||BigInt(view.balances.stockRaw)>=10000000n;
 element("available").textContent=view?units(view.balances.stockRaw,8):"—";
 const primary=element("authorize") as HTMLButtonElement;
 primary.textContent=working?"Confirming…":!connected?(networkReady?"Connect Solflare":"Done — continue"):phase==="ready"?(setup?"Next":"Approve protection"):phase==="armed"&&!frozen?"Protection is active":phase==="awaiting-signature"?"Try approval again":"Reset demo";
 primary.hidden=selecting||(connected&&phase==="armed"&&!frozen);
 primary.disabled=busy||(choosing&&!selectedProtections().priceDrop&&!selectedProtections().supplySpike)||(connected&&(view===null||phase==="armed"&&!frozen));primary.classList.toggle("loading",working);
 primary.classList.toggle("guided-action",!primary.hidden&&!primary.disabled&&!tested);asset.classList.toggle("guided-action",selecting&&!asset.disabled);retry.classList.toggle("guided-action",tested&&!busy&&view!==null&&demoOutcome(view).kind!=="running");
 const connect=element("connect") as HTMLButtonElement;connect.hidden=!connected;connect.disabled=busy||connected;
 const address=wallet?.publicKey?.toBase58();connect.textContent=address?`${address.slice(0,4)}…${address.slice(-4)}`:"Connect wallet";
 element("wallet").textContent=address?`${address.slice(0,6)}…${address.slice(-6)}`:"Not connected";
 element("hint").hidden=selecting||setup||(connected&&phase==="armed"&&!frozen);
 element("hint").textContent=!connected?"":frozen?"Trading is frozen. Reset to try again.":phase==="armed"?"Monitoring · You can close this tab":phase==="exited"?"Exit confirmed. Start a fresh demo.":phase==="awaiting-signature"?"Retry keeps your amount and protections. Reset may wait for transaction expiry.":"Approve once in your wallet";
 element("lab-hint").textContent=!connected||phase==="ready"?"Enable protection to test an event":view?.state.scenario!=="none"?"Reset the demo to try another event":"Choose one simulated event. Watch your asset status.";
 document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach(button=>{
  button.disabled=busy||!connected||phase!=="armed"||view?.state.scenario!=="none";
  button.classList.toggle("selected",view?.state.scenario===button.dataset.scenario);
 });
 const revoke=element("revoke") as HTMLButtonElement;revoke.hidden=!connected||phase!=="armed"||frozen;revoke.disabled=busy;
 element("stock").textContent=connected&&view?units(view.balances.stockRaw,8):"—";
 element("usd").textContent=connected&&view?units(view.balances.usdRaw,6):"—";if(isReplay)decorateReplay(connected);
}
async function action(fn:()=>Promise<void>){
 if(working)return;working=true;element("message").textContent="";render();
 try{await fn();await refresh();}catch(error){
  try{await refresh();}catch(refreshError){console.error("State refresh after failed action",refreshError);}
  element("message").textContent=error instanceof Error?error.message:String(error);
 }
 finally{working=false;render();}
}
async function connect(){
 if(isReplay){wallet=await connectReplay();return;}
 const injected=(window as Window & {solflare?:Solflare}).solflare;
 if(injected===undefined)throw new Error("Open with the Solflare extension installed.");
 await injected.connect();element("message").textContent="Sign in, then wait while free Devnet funds are prepared (up to a minute).";const challenge=await api("challenge",{owner:injected.publicKey?.toBase58()});
 if(injected.publicKey?.toBase58()!==challenge.owner)throw new Error("Wallet changed during login. Please reconnect.");
 const signed=await injected.signMessage(new TextEncoder().encode(challenge.message),"utf8");
 const signature=signed instanceof Uint8Array?signed:signed.signature;
 if(!(signature instanceof Uint8Array)||signature.length!==64)throw new Error("Invalid Solflare message signature");
 token=(await api("login",{message:challenge.message,signature:Buffer.from(signature).toString("base64")})).token;wallet=injected;element("message").textContent="";await refresh();if(view?.state.phase!=="ready"){element("message").textContent="Resetting previous demo…";await resetDemo(true);}resetForm();
}
async function sign(kind:"authorize"|"revoke"){
 if(isReplay){await replayAction(kind,{});return;}
 signing=true;try{
 if(wallet===null)throw new Error("Connect your wallet first");
 const retry=kind==="authorize"&&view?.state.phase==="awaiting-signature"?view.state.policy:null;
 const amountRaw=kind==="authorize"?(retry?retry.amountRaw:selectedAmount()):undefined;
 const protections=kind==="authorize"?(retry?demoProtections(retry.rule):selectedProtections()):undefined;
 const prepared=await api("prepare",{kind,amountRaw,protections}),owner=wallet.publicKey?.toBase58();
 if(kind==="authorize"&&prepared.policy.amountRaw!==amountRaw)throw new Error("Prepared amount differs from your selection");
 if(kind==="authorize"){
  if(prepared.policy.rule.id!=="demo-risk"||prepared.policy.rule.version!==2)throw new Error("Unexpected protection version");
  const enabled=demoProtections(prepared.policy.rule);
  if(enabled.priceDrop!==protections?.priceDrop||enabled.supplySpike!==protections?.supplySpike)throw new Error("Prepared protections differ from your selection");
 }
 if(owner===undefined)throw new Error("Wallet disconnected");
 const tx=await validateDemoTransaction(prepared.transaction,prepared.policy,owner,kind);
 const signed=await wallet.signTransaction(tx);await api("submit",{transaction:signed.serialize().toString("base64")});
 }finally{signing=false;}
}
function selectedProtections(){return {priceDrop:(element("price-protection") as HTMLInputElement).checked,supplySpike:(element("supply-protection") as HTMLInputElement).checked};}
function selectedAmount(){
 const value=(element("amount") as HTMLInputElement).value;
 if(!/^[0-9]+$/.test(value))throw new Error("Invalid slider amount");
 const raw=BigInt(value)*1000000n;
 if(raw<10000000n||raw>1000000000n||view===null||raw>BigInt(view.balances.stockRaw))throw new Error("Choose 0.1–10 demoAAPL within your balance");
 return raw.toString();
}
function updateAmount(){
 const slider=element("amount") as HTMLInputElement,raw=BigInt(slider.value)*1000000n;
 element("amount-value").textContent=units(raw.toString(),8);element("review-amount").textContent=units(raw.toString(),8);
 element("floor").textContent=units((raw*175n/100n).toString(),6);element("amount-max").textContent=units((BigInt(slider.max)*1000000n).toString(),8);
 const span=Number(slider.max)-Number(slider.min);slider.style.setProperty("--fill",`${span===0?100:(Number(slider.value)-Number(slider.min))*100/span}%`);
 slider.setAttribute("aria-valuetext",`${units(raw.toString(),8)} demoAAPL`);
}
element("amount").oninput=updateAmount;
for(const id of ["price-protection","supply-protection"])element(id).onchange=render;
element("asset").onclick=()=>{step="setup";render();};
element("back").onclick=()=>{step=step==="protections"?"setup":"assets";element("message").textContent="";render();};
function resetForm(){(element("result-proof") as HTMLDetailsElement).open=false;step="assets";(element("amount") as HTMLInputElement).value="100";for(const id of ["price-protection","supply-protection"])(element(id) as HTMLInputElement).checked=true;}
async function resetDemo(keepSession=false){
 resetting=true;render();try{
 if(wallet!==null&&view?.state.phase!=="ready"){
  if(view?.balances.frozen)await api("thaw",{});
  if(view?.state.phase==="armed")await sign("revoke");
  await resetAfterExpiry(async()=>{await refresh();if(view?.state.phase==="armed")await sign("revoke");return api("reset",{keepSession});},()=>{element("message").textContent="Waiting for the previous transaction. Reset will continue automatically.";});
  element("message").textContent="";
 }
 resetForm();
 }finally{resetting=false;}
}
element("reset-demo").onclick=()=>action(()=>resetDemo());
element("test-again").onclick=()=>action(()=>resetDemo());
element("connect").onclick=()=>action(connect);
element("authorize").onclick=()=>action(async()=>{
 if(!networkReady){networkReady=true;return;}
 if(wallet===null){await connect();return;}
 if(view?.state.phase==="ready"){
  selectedAmount();
  if(step==="setup"){step="protections";return;}
  await sign("authorize");return;
 }
 if(view?.state.phase==="awaiting-signature"){await sign("authorize");return;}
 await resetDemo();
});
element("revoke").onclick=()=>action(()=>sign("revoke"));
document.querySelectorAll<HTMLButtonElement>("[data-scenario]").forEach(button=>{button.onclick=()=>action(async()=>{testing=button.dataset.scenario!;render();try{await api("scenario",{kind:testing});}finally{testing=null;}});});
function units(raw:string,decimals:number){const n=BigInt(raw),scale=10n**BigInt(decimals);return `${n/scale}.${(n%scale).toString().padStart(decimals,"0").slice(0,2)}`;}
async function refresh(){
 if(wallet===null){render();return;}
 if(isReplay)view=replayView();else{const response=await fetch("/tmp/app/api/state",{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});if(response.status===401){token="";wallet=null;render();throw new Error("Session ended. Reconnect your wallet.");}if(!response.ok)throw new Error("Demo is reconnecting. Please try again shortly.");view=await response.json() as View;}
 element("reason").textContent=view.state.reason;element("activity-count").textContent=String(Math.min(3,view.history.length));
 element("history").replaceChildren(...view.history.slice(0,3).map(row=>{
  const li=document.createElement("li"),a=document.createElement("a");
  const names:Record<string,string>={"guard-exit":"Automatic exit",authorize:"Protection enabled",revoke:"Protection removed","price-collapse":"Price divergence simulated","mint-anomaly":"Supply anomaly simulated",freeze:"Token frozen",thaw:"Token unfrozen","restore-price":"Market reset",refill:"Test tokens refilled"};
  a.textContent=`${names[row.kind]===undefined?row.kind:names[row.kind]} · ${row.status}`;
  a.href=`https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=devnet`;a.target="_blank";a.rel="noopener";li.append(a);return li;
 }));render();
 if(!isReplay&&token!==""){
  const reference=await fetch("/tmp/app/api/reference",{headers:{Authorization:`Bearer ${token}`}});
  if(reference.status===401){token="";wallet=null;render();element("reference").textContent="Reconnect to view market data.";return;}
  if(!reference.ok){element("reference").textContent="AAPL reference unavailable";return;}
  const value=await reference.json();
  element("reference").textContent=value.status==="live"?`AAPL · $${value.bidUsd} bid / $${value.askUsd} ask · IEX`:`AAPL IEX · ${value.status}`;
 }
}
async function poll(){try{await refresh();}catch(error){element("message").textContent=error instanceof Error?error.message:String(error);}setTimeout(poll,isReplay?250:view?.state.phase==="armed"&&view.state.scenario!=="none"?1000:5000);}
window.addEventListener("replay-progress",()=>{if(isReplay){view=replayView();render();}});
void poll();
