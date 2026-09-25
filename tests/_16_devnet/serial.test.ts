import {expect,test} from "bun:test";
import {DemoRuntime} from "../../src/_adapters/_0_solana/_7_demo/_4_runtime/mod";
import type {DemoMarket} from "../../src/_adapters/_0_solana/_7_demo/_3_controls/_0_market/mod";
test("owner submission waits behind a monitor read without concurrent mutation",async()=>{
 const runtime=new DemoRuntime({} as DemoMarket),order:string[]=[];
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const monitor=runtime.exclusive(async()=>{order.push("read");await gate;order.push("read-done");});
 await Promise.resolve();const owner=runtime.exclusive(async()=>{order.push("owner");});
 expect(order).toEqual(["read"]);release();await Promise.all([monitor,owner]);
 expect(order).toEqual(["read","read-done","owner"]);expect(runtime.busy).toBe(false);
 await expect(runtime.exclusive(async()=>{throw new Error("failed operation");})).rejects.toThrow();
 expect(await runtime.exclusive(async()=>"next")).toBe("next");
});
