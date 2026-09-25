export async function resetAfterExpiry(reset:()=>Promise<unknown>,onWait:()=>void){
 const deadline=Date.now()+120000;
 for(;;){
  try{await reset();return;}catch(error){
   if(!(error instanceof Error)||!["Wait for its blockhash to expire","Wait for pending transaction reconciliation","Revoke the active policy in Solflare before resetting","Wallet approval finalized; revoke it before resetting"].some(message=>error.message.includes(message)))throw error;
   console.warn("Demo reset waiting for previous onchain state",error.message);onWait();
   if(Date.now()>=deadline)throw new Error("The previous transaction is still unresolved. Retry reset shortly.");
   await new Promise(resolve=>setTimeout(resolve,3000));
  }
 }
}
