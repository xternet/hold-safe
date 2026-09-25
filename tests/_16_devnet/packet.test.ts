import { expect, test } from "bun:test";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { verifyOwnerPacket } from "../../src/_adapters/_0_solana/_7_demo/_4_runtime/mod";
test("judge submission requires the exact issued message and owner signature", () => {
  const owner=Keypair.generate(), destination=Keypair.generate().publicKey;
  const tx=new Transaction({feePayer:owner.publicKey,recentBlockhash:Keypair.generate().publicKey.toBase58()})
    .add(SystemProgram.transfer({fromPubkey:owner.publicKey,toPubkey:destination,lamports:1}));
  const message=tx.serializeMessage().toString("base64");
  expect(()=>verifyOwnerPacket(tx.serialize({requireAllSignatures:false}).toString("base64"),message,owner.publicKey.toBase58())).toThrow();
  tx.sign(owner);
  expect(verifyOwnerPacket(tx.serialize().toString("base64"),message,owner.publicKey.toBase58()).signature).not.toBeNull();
  tx.instructions[0]!.data[4]=2;tx.sign(owner);
  expect(()=>verifyOwnerPacket(tx.serialize().toString("base64"),message,owner.publicKey.toBase58())).toThrow();
});
