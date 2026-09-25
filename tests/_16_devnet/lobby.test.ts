import {expect,test} from "bun:test";
import {canRelease} from "../../src/_adapters/_0_solana/_7_demo/_6_lobby/mod";
test("a shared market cannot move between owners while a signed policy or packet can execute",()=>{
 const now=1000;
 expect(canRelease({busy:false,pending:0,issuedHeight:null,height:10,policyExpiry:null,leaseUntil:2000},now)).toBe(false);
 expect(canRelease({busy:false,pending:0,issuedHeight:11,height:10,policyExpiry:null,leaseUntil:0},now)).toBe(false);
 expect(canRelease({busy:false,pending:0,issuedHeight:null,height:10,policyExpiry:2000,leaseUntil:0},now)).toBe(false);
 expect(canRelease({busy:false,pending:1,issuedHeight:null,height:10,policyExpiry:null,leaseUntil:0},now)).toBe(false);
 expect(canRelease({busy:false,pending:0,issuedHeight:9,height:10,policyExpiry:900,leaseUntil:0},now)).toBe(true);
});
