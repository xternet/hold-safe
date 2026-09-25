import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { ExtensionType, createApproveCheckedInstruction, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { fixture, assertSuccess, failure } from "../_0_fixture/mod";
import { authorize, execute, revoke, discr } from "../_shared/mod";
import { INPUT_MINT } from "../../_2_swap/_shared/mod";
import { send, readToken } from "../../_2_swap/_1_fixture/_1_accounts/mod";

type Fixture = ReturnType<typeof fixture>;
function mutate(f: Fixture, key: PublicKey, edit: (data: Buffer) => void) {
  const account = f.svm.getAccount(address(key.toBase58()));
  if (!account.exists) throw new Error("Missing mutation fixture");
  const data = Buffer.from(account.data); edit(data); f.svm.setAccount({ ...account, data });
}
function extension(data: Buffer, type: ExtensionType): number {
  let offset = 166;
  while (offset + 4 <= data.length) {
    const tag = data.readUInt16LE(offset), size = data.readUInt16LE(offset + 2);
    if (tag === type) return offset + 4;
    offset += 4 + size;
  }
  throw new Error(`Required fixture extension missing: ${type}`);
}

test("unsafe mint changes between approval and execution disable the policy", () => {
  const changes = [
    (data: Buffer) => data.writeUInt8(1, extension(data, ExtensionType.PausableConfig) + 32),
    (data: Buffer) => data.fill(9, extension(data, ExtensionType.TransferHook) + 32, extension(data, ExtensionType.TransferHook) + 64),
    (data: Buffer) => data.writeUInt8(2, extension(data, ExtensionType.DefaultAccountState)),
    (data: Buffer) => data.writeDoubleLE(0, extension(data, ExtensionType.ScaledUiAmountConfig) + 32),
    (data: Buffer) => data.writeUInt16LE(ExtensionType.TransferFeeConfig, extension(data, ExtensionType.MetadataPointer) - 4),
  ];
  for (const change of changes) {
    const f = fixture(); assertSuccess(f.arm()); const before = f.balances();
    mutate(f, new PublicKey(INPUT_MINT), change);
    expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("UnsupportedToken");
    expect(f.balances()).toEqual(before); expect(f.state()).toBe(1);
  }
});

test("frozen source and insufficient allowance cannot transfer anything", () => {
  const f = fixture(); assertSuccess(f.arm()); const before = f.balances();
  mutate(f, f.a.source, (data) => data.writeUInt8(2, 108));
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("UnsupportedToken");
  expect(f.balances()).toEqual(before);
  const g = fixture(); assertSuccess(g.arm());
  assertSuccess(send(g.svm, [createApproveCheckedInstruction(g.a.source, new PublicKey(INPUT_MINT),
    g.a.policy, g.a.owner.publicKey, g.a.amount - 1n, 8, [], TOKEN_2022_PROGRAM_ID)], g.a.owner));
  expect(failure(g.run(execute(g.snapshot, g.a)))).toContain("InvalidDelegate");
  expect(g.state()).toBe(1); expect(readToken(g.svm, g.a.source).allowance).toBe(g.a.amount - 1n);
});

test("tick aliases, missing ticks, foreign pool data and guarded account aliases fail", () => {
  for (const kind of ["duplicate", "missing", "foreign", "staging-source", "recipient-source"]) {
    const f = fixture(); assertSuccess(f.arm()); const instruction = execute(f.snapshot, f.a);
    if (kind === "duplicate") instruction.keys.push(instruction.keys.at(-1)!);
    if (kind === "missing") instruction.keys = instruction.keys.slice(0, 16);
    if (kind === "foreign") mutate(f, instruction.keys[17]!.pubkey, (data) => data.fill(0, 8, 40));
    if (kind === "staging-source") instruction.keys[3]!.pubkey = f.a.source;
    if (kind === "recipient-source") instruction.keys[4]!.pubkey = f.a.source;
    const before = f.balances();
    expect(failure(f.run(instruction)).length).toBeGreaterThan(0);
    expect(f.balances()).toEqual(before); expect(f.state()).toBe(1);
  }
});

test("only owner can cancel; consumed/revoked order IDs cannot be reinitialized", () => {
  for (const terminal of ["consume", "revoke"]) {
    const f = fixture(); assertSuccess(f.arm());
    const wrong = revoke(f.a); wrong.keys[0]!.pubkey = f.a.delegate.publicKey;
    expect(failure(send(f.svm, [wrong], f.a.delegate))).toContain("InvalidAccount");
    if (terminal === "consume") assertSuccess(f.run(execute(f.snapshot, f.a)));
    else assertSuccess(send(f.svm, [revoke(f.a)], f.a.owner));
    f.svm.expireBlockhash();
    expect(failure(f.arm()).length).toBeGreaterThan(0);
    expect(f.state()).toBe(terminal === "consume" ? 2 : 3);
  }
});

test("owner authorization rejects wrong recipient, source, pool and staging", () => {
  for (const index of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    const f = fixture(); const before = f.balances();
    const instruction = authorize(f.snapshot, f.a, f.now);
    instruction.keys[index]!.pubkey = f.a.owner.publicKey;
    expect(failure(send(f.svm, [instruction], f.a.owner)).length).toBeGreaterThan(0);
    expect(f.state()).toBe("absent"); expect(f.balances()).toEqual(before);
    expect(readToken(f.svm, f.a.source).allowance).toBe(0n);
  }
});

test("excess manual allowance and additional deposits never increase the one-shot amount", () => {
  const f = fixture(); assertSuccess(f.arm());
  assertSuccess(send(f.svm, [createApproveCheckedInstruction(f.a.source, new PublicKey(INPUT_MINT),
    f.a.policy, f.a.owner.publicKey, f.a.amount * 2n, 8, [], TOKEN_2022_PROGRAM_ID)], f.a.owner));
  const before = f.balances(); assertSuccess(f.run(execute(f.snapshot, f.a)));
  expect(before[0]! - f.balances()[0]!).toBe(f.a.amount);
  expect(readToken(f.svm, f.a.source).allowance).toBe(f.a.amount);
  f.svm.expireBlockhash();
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("InactivePolicy");
});

test("unknown instruction and transient transfer-hook state are rejected", () => {
  const f = fixture(); assertSuccess(f.arm()); const instruction = execute(f.snapshot, f.a);
  instruction.data = discr("arbitrary_cpi");
  expect(failure(f.run(instruction))).toContain("InstructionFallbackNotFound");
  mutate(f, f.a.source, (data) => data.writeUInt8(1, extension(data, ExtensionType.TransferHookAccount)));
  expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("UnsupportedToken");
  expect(f.state()).toBe(1);
});

test("owner can cancel while mint is paused", () => {
  const f = fixture(); assertSuccess(f.arm());
  mutate(f, new PublicKey(INPUT_MINT), (data) => data.writeUInt8(1, extension(data, ExtensionType.PausableConfig) + 32));
  assertSuccess(send(f.svm, [revoke(f.a)], f.a.owner));
  expect(f.state()).toBe(3); expect(readToken(f.svm, f.a.source).allowance).toBe(0n);
});
