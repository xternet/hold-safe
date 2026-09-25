import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { canonicalPolicy, demoProtections, type Policy } from "../../../../_kernel/mod";
import { sha256 } from "@noble/hashes/sha256";
import { DEVNET, DEMO_GUARD, DEMO_DEX } from "../../_shared/_0_identity/mod";
import { authorizeInstruction, revokeInstruction } from "../../_shared/_2_codec/_0_instructions/mod";
import { policyAddress, stagingAddress } from "../../_shared/_2_codec/_shared/mod";

export async function validateDemoTransaction(raw:string, policy:Policy, owner:string, kind:"authorize"|"revoke", now=Date.now()) {
  const mint=new PublicKey("3GpMzB5Pay6xFTBVa6cvsS3NgaJeuDzLYnWWnJ4CkMeA"),output=new PublicKey("7apSGhTb5doJUo26C5FwrLE2APDTZ7GkNuSHeW2LEuuB");
  const wallet=new PublicKey(owner);
  if(policy.owner!==owner||policy.chain.reference!==DEVNET||policy.chain.namespace!=="solana"||policy.guard!==DEMO_GUARD.toBase58()||
    policy.keeper!=="Hib3q3EQYFKK5vgt1JmMyk3FegYDGsm8Q9VErJxbL74W"||policy.input.address!==mint.toBase58()||policy.output.address!==output.toBase58()||
    policy.coverage.program!==DEMO_DEX.toBase58()||policy.coverage.pool!=="6k79iijMarTLC5qTqT19U8Fqb25YzY6C1xnN7nKvnfUJ"||
    !/^[1-9][0-9]*$/.test(policy.amountRaw)||BigInt(policy.amountRaw)<10000000n||BigInt(policy.amountRaw)>1000000000n||policy.minimumOutputRaw!==(BigInt(policy.amountRaw)*175n/100n).toString()||policy.slippageBps!==100||
    policy.source!==getAssociatedTokenAddressSync(mint,wallet,false,TOKEN_2022_PROGRAM_ID).toBase58()||
    policy.recipient!==getAssociatedTokenAddressSync(output,wallet,false,TOKEN_PROGRAM_ID).toBase58())throw new Error("Unreviewed demo authorization bounds");
  if(policy.rule.id!=="demo-risk"||![1,2].includes(policy.rule.version)||policy.rule.referenceMode!=="replay"||policy.rule.thresholdBps!==300||policy.rule.persistenceMs!==3000||
    !/^[1-9][0-9]*$/.test(policy.rule.supplyBaselineRaw))throw new Error("Unexpected demo risk rule");
  demoProtections(policy.rule);
  if(kind==="authorize"&&(!Number.isSafeInteger(policy.expiresAt)||policy.expiresAt<=now/1000||policy.expiresAt>Math.floor(now/1000)+86400))throw new Error("Unreviewed expiry");
  const tx=Transaction.from(Buffer.from(raw,"base64"));
  if(tx.feePayer?.toBase58()!==owner||tx.signatures.length!==1||tx.signatures.some(s=>s.signature!==null)||!tx.recentBlockhash)throw new Error("Invalid unsigned owner packet");
  const expected=new Transaction({feePayer:wallet,recentBlockhash:tx.recentBlockhash}).add(
    ComputeBudgetProgram.setComputeUnitLimit({units:kind==="authorize"?600000:100000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:0}));
  if(kind==="revoke")expected.add(revokeInstruction(policy));
  else{
    const authorization=tx.instructions[3];
    if(tx.instructions.length!==4||authorization===undefined||authorization.keys.length!==17)throw new Error("Unexpected authorization instructions");
    expected.add(createAssociatedTokenAccountIdempotentInstruction(wallet,stagingAddress(policy),policyAddress(policy),mint,TOKEN_2022_PROGRAM_ID),
      authorizeInstruction(policy,Buffer.from(sha256(new TextEncoder().encode(canonicalPolicy(policy)))).toString("hex"),authorization.keys.slice(6,16).map(k=>k.pubkey.toBase58()),true));
  }
  if(!expected.serializeMessage().equals(tx.serializeMessage()))throw new Error("Transaction does not match reviewed demo policy");
  return tx;
}
