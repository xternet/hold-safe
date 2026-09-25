import { nativePolicy } from "../../src/_adapters/_0_solana/_shared/_0_identity/mod";
import { policyAddress } from "../../src/_adapters/_0_solana/_shared/_2_codec/_shared/mod";
import { quoteFixture } from "../_6_quotes/_shared/mod";
import { test, expect } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { fixture, failure } from "../_0_permissions/_0_fixture/mod";
import { authorize, ORDER } from "../_0_permissions/_shared/mod";
import { send } from "../_2_swap/_1_fixture/_1_accounts/mod";

test("Devnet guard rejects a mainnet policy domain without moving tokens", () => {
  const f = fixture(), guard = new PublicKey("Az4M4V4fFC2ZxNb3SwbSmWWKmXD66HhCFmaduKJDqcA4");
  f.svm.addProgramFromFile(address(guard.toBase58()), ".tools/guard-devnet/solstock_guard.so");
  const policy = PublicKey.findProgramAddressSync([Buffer.from("policy"), f.a.owner.publicKey.toBuffer(), ORDER], guard)[0];
  const instruction = authorize(f.snapshot, { ...f.a, policy }, f.now);
  instruction.programId = guard;
  const before = f.balances();
  expect(failure(send(f.svm, [instruction], f.a.owner))).toContain("InvalidDomain");
  expect(f.balances()).toEqual(before);
  expect(f.svm.getAccount(address(policy.toBase58())).exists).toBe(false);
});

test("Devnet codec pins the selected guard, DEX and genesis without changing mainnet defaults", async () => {
  const f = quoteFixture(), policy = structuredClone(f.policy);
  const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", guard = "Az4M4V4fFC2ZxNb3SwbSmWWKmXD66HhCFmaduKJDqcA4";
  for (const chain of [policy.chain, policy.input.chain, policy.output.chain]) chain.reference = genesis;
  policy.guard = guard; policy.coverage.program = "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH";
  expect(() => nativePolicy(policy)).not.toThrow();
  expect(policyAddress(policy).equals(PublicKey.findProgramAddressSync([Buffer.from("policy"),new PublicKey(policy.owner).toBuffer(),Buffer.from(policy.orderId,"hex")],new PublicKey(guard))[0])).toBe(true);
  expect(() => nativePolicy({ ...policy, guard: f.policy.guard })).toThrow();
  expect(() => nativePolicy(f.policy)).not.toThrow();
});
