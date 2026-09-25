import { createPublicKey, randomBytes, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { DemoRuntime } from "../_4_runtime/mod";
import type {DemoLobby} from "../_6_lobby/mod";
import type {DemoReferencePort} from "../../../../_kernel/mod";

export function demoHttp(runtime:DemoRuntime, origin:string,reference?:DemoReferencePort,lobby?:DemoLobby) {
  const challenges=new Map<string,number>(),sessions=new Map<string,{expiry:number;owner:string}>();
  const owner=runtime.market.chain.env.judge.owner;
  let balanceRead:Promise<Awaited<ReturnType<typeof runtime.market.balances>>>|null=null,balanceAt=0;
  const balances=()=>{
    if(balanceRead===null||Date.now()-balanceAt>10000){
      balanceAt=Date.now();balanceRead=runtime.market.balances().catch(error=>{balanceRead=null;throw error;});
    }
    return balanceRead;
  };
  const key=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),new PublicKey(owner).toBuffer()]),format:"der",type:"spki"});
  return async (request:Request):Promise<Response>=>{
    const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
    const mutate=async(operation:()=>Promise<unknown>)=>{try{return json(await operation());}finally{balanceRead=null;}};
    try {
      const url=new URL(request.url),path=url.pathname;
      const sessionToken=request.headers.get("authorization")?.replace(/^Bearer /,"");
      const user=sessionToken===undefined?undefined:sessions.get(sessionToken);
      if(lobby!==undefined)runtime=lobby.current;
      if(request.method==="GET"&&path==="/tmp/app/api/reference"){
        const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
        const session=token===undefined?undefined:sessions.get(token);
        const expiry=session?.expiry;
        if(expiry===undefined||expiry<=Date.now())return json({error:"Wallet login required"},401);
        if(reference===undefined)return json({error:"Live reference is not configured"},503);
        return json(reference.read());
      }
      if(request.method==="GET"&&path==="/tmp/app/api/state"){
       if(lobby!==undefined&&(user===undefined||user.expiry<=Date.now()||user.owner!==runtime.market.chain.env.judge.owner))return json({error:"Connect your wallet to start a live session"},401);
       return json({
        owner:runtime.market.chain.env.judge.owner,network:"devnet",state:runtime.market.chain.journal.read(),busy:runtime.busy,
        observation:runtime.observation,balances:await balances(),balancesObservedAt:balanceAt,history:runtime.market.chain.journal.history()});
      }
      if(request.method!=="POST")return json({error:"Not found"},404);
      if(request.headers.get("origin")!==origin)throw new Error("Unapproved browser origin");
      const text=await request.text();if(text.length>4096)throw new Error("Request too large");
      const body:unknown=JSON.parse(text);
      if(typeof body!=="object"||body===null||Array.isArray(body))throw new Error("Invalid request");
      const data=body as Record<string,unknown>;
      const now=Date.now();for(const [nonce,expiry] of challenges)if(expiry<now)challenges.delete(nonce);
      for(const [token,value] of sessions)if(value.expiry<now)sessions.delete(token);
      if(path==="/tmp/app/api/challenge") {
        if(challenges.size>=20)throw new Error("Too many pending login challenges");
        const requested=lobby===undefined?owner:new PublicKey(String(data.owner)).toBase58();
        const message=`HoldSafe Devnet demo\nOrigin: ${origin}\nWallet: ${requested}\nNonce: ${randomBytes(32).toString("hex")}`;
        challenges.set(message,now+120000);return json({message,owner:requested});
      }
      if(path==="/tmp/app/api/login") {
        if(typeof data.message!=="string"||typeof data.signature!=="string")throw new Error("Missing wallet signature");
        const expiry=challenges.get(data.message);challenges.delete(data.message);
        const requested=data.message.split("\n")[2]?.replace("Wallet: ","");
        if(requested===undefined)throw new Error("Missing wallet identity");
        const loginKey=lobby===undefined?key:createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),new PublicKey(requested).toBuffer()]),format:"der",type:"spki"});
        if(expiry===undefined||expiry<now||!verify(null,Buffer.from(data.message),loginKey,Buffer.from(data.signature,"base64")))throw new Error("Invalid or expired wallet signature");
        if(sessions.size>=100)throw new Error("Too many sessions; retry later");
        if(lobby!==undefined){await lobby.acquire(requested);balanceRead=null;}
        const token=randomBytes(32).toString("hex");sessions.set(token,{expiry:now+3600000,owner:requested});return json({token});
      }
      const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
      if(token===undefined||!sessions.has(token))return json({error:"Connect your wallet first"},401);
      const run=<T>(fn:(r:DemoRuntime)=>Promise<T>)=>lobby===undefined?fn(runtime):lobby.use(sessions.get(token)!.owner,fn);
      if(path==="/tmp/app/api/prepare"&&data.amountRaw!==undefined&&typeof data.amountRaw!=="string")throw new Error("Amount must be raw integer text");
      if(path==="/tmp/app/api/prepare"&&(data.kind==="authorize"||data.kind==="revoke"))return json(await run(r=>r.prepare(data.kind as "authorize"|"revoke",data.amountRaw as string|undefined,data.protections)));
      if(path==="/tmp/app/api/submit"&&typeof data.transaction==="string"){const raw=data.transaction;return await mutate(()=>run(r=>r.submit(raw)));}
      if(path==="/tmp/app/api/scenario"&&(data.kind==="collapse"||data.kind==="mint"||data.kind==="freeze")){const kind=data.kind;return await mutate(()=>run(r=>r.scenario(kind)));}
      if(path==="/tmp/app/api/reset")return await mutate(()=>lobby===undefined?runtime.reset():lobby.reset(sessions.get(token)!.owner,data.keepSession===true));
      if(path==="/tmp/app/api/thaw")return await mutate(()=>run(r=>r.exclusive(()=>r.actions.thaw())));
      return json({error:"Unsupported demo operation"},400);
    }catch(error){
      console.error(JSON.stringify({phase:"demo-http",error:error instanceof Error?error.message:String(error)}));
      return json({error:error instanceof Error?error.message:"Demo request failed"},400);
    }
  };
}
