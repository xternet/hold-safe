import { DemoChain } from "./_2_chain/mod";
import { DemoMarket } from "./_3_controls/_0_market/mod";
import { DemoRuntime } from "./_4_runtime/mod";
import {DemoLobby} from "./_6_lobby/mod";
import { demoHttp } from "./_5_http/mod";
import type {DemoReferencePort} from "../../../_kernel/mod";

export async function runDemo(signal:AbortSignal,reference:DemoReferencePort) {
  const environment=process.env.SOLSTOCK_DEMO_ENV,origin=process.env.SOLSTOCK_DEMO_ORIGIN;
  if(environment===undefined||origin===undefined)throw new Error("Demo environment path and browser origin required");
  const chain=await DemoChain.open(environment),runtime=new DemoRuntime(await DemoMarket.open(chain));
  await reference.start();
  const lobby=await DemoLobby.open(runtime),handler=demoHttp(runtime,origin,reference,lobby);
  let requests=0;
  const server=Bun.serve({hostname:"127.0.0.1",port:3107,idleTimeout:120,maxRequestBodySize:4096,async fetch(request){
    const path=new URL(request.url).pathname;
    if(path.startsWith("/tmp/app/api/")){
      if(requests>=8)return Response.json({error:"Demo is busy; retry shortly"},{status:429});
      requests++;try{return await handler(request);}finally{requests--;}
    }
    if(request.method!=="GET")return new Response("Not found",{status:404});
    const files:Record<string,string>={"/tmp/app":"src/_5_app/_8_entry/index.html","/tmp/app/":"src/_5_app/_8_entry/index.html","/tmp/app/live":"src/_5_app/_5_demo/index.html","/tmp/app/replay":"src/_5_app/_5_demo/index.html","/tmp/app/replay.json":"config/demo-replay.json","/tmp/app/demo.js":"dist-demo/demo.js"};
    const file=files[path];
    if(file===undefined)return new Response("Not found",{status:404});
    return new Response(Bun.file(file),{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
  }});
  console.log("Devnet demo listening on 127.0.0.1:3107/tmp/app");
  try{while(!signal.aborted){try{await lobby.tick();}catch(error){lobby.current.error(error);}await Bun.sleep(2500);}}
  finally{await server.stop(true);await reference.stop();lobby.close();chain.journal.close();}
}
