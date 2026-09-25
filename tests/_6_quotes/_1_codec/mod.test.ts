import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { policyDigest } from "../../../src/_kernel/mod";
import { authorizeInstruction, executeInstruction, revokeInstruction, decodePolicy, assertPolicyBinding } from "../../../src/_adapters/_0_solana/_shared/_2_codec/mod";
import { quoteNativeState } from "../../../src/_adapters/_0_solana/_venues/_0_raydium/_0_math/mod";
import { quoteFixture } from "../_shared/mod";
import { assertSuccess, failure } from "../../_0_permissions/_0_fixture/mod";
import { send } from "../../_2_swap/_1_fixture/_1_accounts/mod";

test("production codecs authorize, decode and execute exact quoted ticks against real guard", async () => {
  const f = quoteFixture(), digest = await policyDigest(f.policy);
  const quote = quoteNativeState(f.policy, f.catalog, f.batch);
  assertSuccess(send(f.svm, [authorizeInstruction(f.policy, digest, quote.routeKeys, false)], f.a.owner));
  const account = f.svm.getAccount(address(f.a.policy.toBase58()));
  if (!account.exists) throw new Error("Missing guarded policy");
  const native = decodePolicy({ data: Buffer.from(account.data), owner: new PublicKey(account.programAddress) }, f.a.policy);
  expect(native.amount).toBe(f.a.amount.toString()); expect(native.state).toBe("active");
  assertPolicyBinding(f.policy, digest, native);
  expect(() => assertPolicyBinding({ ...f.policy, keeper: f.a.delegate.publicKey.toBase58() }, digest, native)).toThrow();
  expect(() => assertPolicyBinding({ ...f.policy, amountRaw: "1" }, digest, native)).toThrow();
  expect(() => assertPolicyBinding(f.policy, "00".repeat(32), native)).toThrow();
  assertSuccess(f.run(executeInstruction(f.policy, quote)));
  expect(f.balances()[2]!.toString()).toBe(quote.outputRaw);
  f.svm.expireBlockhash();
  expect(failure(f.run(executeInstruction(f.policy, quote)))).toContain("InactivePolicy");
});

test("production revoke codec cancels policy and native decoder rejects foreign/truncated data", async () => {
  const f = quoteFixture(), digest = await policyDigest(f.policy);
  const quote = quoteNativeState(f.policy, f.catalog, f.batch);
  assertSuccess(send(f.svm, [authorizeInstruction(f.policy, digest, quote.routeKeys, false)], f.a.owner));
  assertSuccess(send(f.svm, [revokeInstruction(f.policy)], f.a.owner));
  const account = f.svm.getAccount(address(f.a.policy.toBase58()));
  if (!account.exists) throw new Error("Missing guarded policy");
  const raw = { data: Buffer.from(account.data), owner: new PublicKey(account.programAddress) };
  expect(decodePolicy(raw, f.a.policy).state).toBe("revoked");
  expect(() => decodePolicy({ ...raw, owner: f.a.owner.publicKey }, f.a.policy)).toThrow();
  expect(() => decodePolicy({ ...raw, data: raw.data.subarray(0, 100) }, f.a.policy)).toThrow();
  expect(() => decodePolicy(raw, f.a.source)).toThrow();
});
