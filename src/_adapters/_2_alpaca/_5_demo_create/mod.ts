import {lstat,readFile} from "node:fs/promises";
import {AlpacaFeed} from "../_3_stream/mod";
import {LiveCalendar} from "../_2_calendar/mod";
import type {Fault} from "../../../_kernel/mod";
import {DemoReference} from "../_4_demo/mod";

export async function createDemoReference(path:string|undefined,log:(fault:Fault)=>void) {
  if(path===undefined)throw new Error("SOLSTOCK_DEMO_ALPACA_FILE is required for the live reference panel");
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.uid!==process.getuid!())throw new Error("Insecure Alpaca credential file");
  const credentials:unknown=JSON.parse(await readFile(path,"utf8"));
  if(typeof credentials!=="object"||credentials===null||!("key" in credentials)||!("secret" in credentials)||
    typeof credentials.key!=="string"||typeof credentials.secret!=="string"||!credentials.key||!credentials.secret)throw new Error("Invalid Alpaca credentials");
  const keys={key:credentials.key,secret:credentials.secret},calendar=new LiveCalendar(keys,log);
  return new DemoReference(new AlpacaFeed(keys,["AAPL"],calendar,log,Date.now,undefined,"iex"),calendar);
}
