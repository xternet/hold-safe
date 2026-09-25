import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { createApproveCheckedInstruction, createRevokeInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { fixture, assertSuccess, failure } from "./_0_fixture/mod";
import { authorize, execute, revoke } from "./_shared/mod";
import { send, readToken } from "../_2_swap/_1_fixture/_1_accounts/mod";
import { INPUT_MINT } from "../_2_swap/_shared/mod";

test("owner arms bounded PDA delegation; keeper exits once using real CLMM", () => {
  const f = fixture(); const before = f.balances();
  assertSuccess(f.arm());
  expect(f.balances()).toEqual(before);
  expect(readToken(f.svm, f.a.source).allowance).toBe(f.a.amount);
  const source = f.svm.getAccount(address(f.a.source.toBase58()));
  if (!source.exists) throw new Error("Missing authorized source fixture");
  expect(new PublicKey(source.data.slice(76, 108)).toBase58()).toBe(f.a.policy.toBase58());
  expect(f.state()).toBe(1);
  assertSuccess(f.run(execute(f.snapshot, f.a)));
  const after = f.balances();
  expect(before[0]! - after[0]!).toBe(f.a.amount);
  expect(after[1]).toBe(before[1]); expect(after[2]!).toBeGreaterThan(before[2]!);
  expect(f.state()).toBe(2); expect(readToken(f.svm, f.a.source).allowance).toBe(0n);
  f.svm.expireBlockhash();
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("InactivePolicy");
  expect(f.balances()).toEqual(after);
});

test("user hard floor defeats keeper zero minimum and rolls everything back", () => {
  const f = fixture(); assertSuccess(f.arm({ floor: 1_000_000_000_000n }));
  const before = f.balances();
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("TooLittleOutputReceived");
  expect(f.balances()).toEqual(before); expect(f.state()).toBe(1);
  expect(readToken(f.svm, f.a.source).allowance).toBe(f.a.amount);
});

test("stricter attempt floor rolls back, then a fresh allowed attempt succeeds", () => {
  const f = fixture(); assertSuccess(f.arm()); const before = f.balances();
  expect(failure(f.run(execute(f.snapshot, f.a, 1_000_000_000_000n)))).toContain("TooLittleOutputReceived");
  expect(f.state()).toBe(1); expect(f.balances()).toEqual(before);
  assertSuccess(f.run(execute(f.snapshot, f.a, 0n)));
  expect(f.state()).toBe(2);
});

test("owner and ordinary SPL revocation block execution", () => {
  for (const direct of [false, true]) {
    const f = fixture(); assertSuccess(f.arm());
    const instruction = direct ? createRevokeInstruction(f.a.source, f.a.owner.publicKey, [], TOKEN_2022_PROGRAM_ID) : revoke(f.a);
    assertSuccess(send(f.svm, [instruction], f.a.owner));
    const before = f.balances();
    expect(failure(f.run(execute(f.snapshot, f.a)))).toContain(direct ? "InvalidDelegate" : "InactivePolicy");
    expect(f.balances()).toEqual(before);
  }
});

test("foreign keeper and altered route/account identities are rejected atomically", () => {
  for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    const f = fixture(); assertSuccess(f.arm()); const before = f.balances();
    const instruction = execute(f.snapshot, f.a);
    const old = instruction.keys[index]!;
    instruction.keys[index] = { ...old, pubkey: index === 0 ? f.a.delegate.publicKey : f.a.owner.publicKey };
    const result = index === 0 ? send(f.svm, [instruction], f.a.delegate) : f.run(instruction);
    expect(failure(result).length).toBeGreaterThan(0);
    expect(f.balances()).toEqual(before); expect(f.state()).toBe(1);
  }
});

test("authorization rejects bad bounds, domain, version and wrong owner", () => {
  for (const options of [{ amount: 0n }, { floor: 0n }, { expiry: 1n }, { version: 2 }, { domain: PublicKey.default }]) {
    const f = fixture(); expect(failure(f.arm(options)).length).toBeGreaterThan(0);
    expect(f.state()).toBe("absent"); expect(readToken(f.svm, f.a.source).allowance).toBe(0n);
  }
  const f = fixture(); const instruction = authorize(f.snapshot, f.a, f.now);
  instruction.keys[0]!.pubkey = f.a.delegate.publicKey;
  expect(failure(send(f.svm, [instruction], f.a.delegate)).length).toBeGreaterThan(0);
  expect(f.state()).toBe("absent");
});

test("existing delegate replacement requires explicit signed option", () => {
  const f = fixture();
  assertSuccess(send(f.svm, [createApproveCheckedInstruction(f.a.source, new PublicKey(INPUT_MINT),
    f.a.delegate.publicKey, f.a.owner.publicKey, f.a.amount, 8, [], TOKEN_2022_PROGRAM_ID)], f.a.owner));
  expect(failure(f.arm())).toContain("DelegateReplacementRequired");
  assertSuccess(f.arm({ replace: true }));
  assertSuccess(f.run(execute(f.snapshot, f.a)));
});

test("expired policy cannot execute; unsolicited staging dust is preserved", () => {
  const f = fixture(); assertSuccess(f.arm());
  const clock = f.svm.getClock(); clock.unixTimestamp = f.now + 3601n; f.svm.setClock(clock);
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("ExpiredPolicy");
  const g = fixture(); assertSuccess(g.arm());
  const account = g.svm.getAccount(address(g.a.staging.toBase58()));
  if (!account.exists) throw new Error("Missing staging fixture");
  const data = Buffer.from(account.data); data.writeBigUInt64LE(7n, 64);
  g.svm.setAccount({ ...account, data });
  assertSuccess(g.run(execute(g.snapshot, g.a)));
  expect(readToken(g.svm, g.a.staging).amount).toBe(7n);
});
