import {expect,test} from "bun:test";
import {resetAfterExpiry} from "./mod";
test("reset waits for pending reconciliation and retries instead of discarding onchain state",async()=>{
 let attempts=0,waits=0;
 await resetAfterExpiry(async()=>{attempts++;if(attempts===1)throw new Error("Wait for pending transaction reconciliation");},()=>{waits++;});
 expect(attempts).toBe(2);expect(waits).toBe(1);
});
test("reset preserves unexpected errors rather than silently retrying",async()=>{
 await expect(resetAfterExpiry(async()=>{throw new Error("User rejected approval");},()=>{})).rejects.toThrow("User rejected approval");
});
