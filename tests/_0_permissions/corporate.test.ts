import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { ExtensionType } from "@solana/spl-token";
import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { quoteFixture } from "../_6_quotes/_shared/mod";
import { assertSuccess, failure } from "./_0_fixture/mod";
import { execute, revoke } from "./_shared/mod";
import { readToken, send } from "../_2_swap/_1_fixture/_1_accounts/mod";
import { decodeAccountHolding } from "../../src/_adapters/_0_solana/_0_reader/_0_decode/mod";
import { quoteNativeState } from "../../src/_adapters/_0_solana/_venues/_0_raydium/_0_math/mod";

function scheduled() {
  const f = quoteFixture(), activation = (f.now / 86400n + 2n) * 86400n + 1800n;
  f.policy.expiresAt = Number(activation + 3600n);
  return { ...f, activation };
}
function update(f: ReturnType<typeof scheduled>, now: bigint, activation = f.activation, next = 2) {
  const key = f.policy.input.address, account = f.svm.getAccount(address(key));
  if (!account.exists) throw new Error("Missing mint fixture");
  const data = Buffer.from(account.data);
  let offset = 166;
  while (offset + 4 <= data.length && data.readUInt16LE(offset) !== ExtensionType.ScaledUiAmountConfig) offset += 4 + data.readUInt16LE(offset + 2);
  if (offset + 60 > data.length) throw new Error("Missing scaled config fixture");
  data.writeDoubleLE(1, offset + 4 + 32); data.writeBigInt64LE(activation, offset + 4 + 40);
  data.writeDoubleLE(next, offset + 4 + 48);
  f.svm.setAccount({ ...account, data });
  f.batch.accounts.set(key, { data, owner: new PublicKey(account.programAddress), lamports: Number(account.lamports), executable: false });
  const clock = f.svm.getClock(); clock.unixTimestamp = now; f.svm.setClock(clock);
  const original = f.batch.accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!;
  const bytes = Buffer.from(original.data); bytes.writeBigInt64LE(now, 32);
  f.batch.accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), { ...original, data: bytes }); f.batch.observedAtMs = Number(now) * 1000;
  const source = f.svm.getAccount(address(f.policy.source));
  if (!source.exists) throw new Error("Missing source fixture");
  f.batch.accounts.set(f.policy.source, { data: Buffer.from(source.data), owner: new PublicKey(source.programAddress), lamports: Number(source.lamports), executable: false });
}
const holding = (f: ReturnType<typeof scheduled>) => decodeAccountHolding(f.policy.input, f.policy.owner, f.policy.source,
  f.catalog, f.batch.accounts, f.batch.slot, f.batch.observedAtMs);

test("scheduled adjustment window agrees across holdings, quotes and native execution", () => {
  for (const offset of [-88201n, -88200n, -1n, 0n, 299n, 300n]) {
    const f = scheduled(); assertSuccess(f.arm({ expiry: f.activation + 3600n }));
    const before = f.balances(); update(f, f.activation + offset);
    const blocked = offset >= -88200n && offset < 300n;
    if (blocked) {
      expect(() => holding(f)).toThrow("Corporate action");
      expect(() => quoteNativeState(f.policy, f.catalog, f.batch)).toThrow("Corporate action");
      expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("CorporateActionWindow");
      expect(f.balances()).toEqual(before); expect(f.state()).toBe(1);
      expect(readToken(f.svm, f.a.source).allowance).toBe(f.a.amount);
    } else {
      expect(holding(f).multiplier).toEqual({ n: offset < 0n ? 1n : 2n, d: 1n });
      const quote = quoteNativeState(f.policy, f.catalog, f.batch);
      assertSuccess(f.run(execute(f.snapshot, f.a)));
      expect(f.balances()[2]!.toString()).toBe(quote.outputRaw); expect(f.state()).toBe(2);
    }
  }
});
test("corporate window prevents approval but owner can revoke existing approval", () => {
  const f = scheduled(); update(f, f.activation);
  expect(failure(f.arm({ expiry: f.activation + 3600n }))).toContain("CorporateActionWindow");
  expect(f.state()).toBe("absent"); expect(readToken(f.svm, f.a.source).allowance).toBe(0n);
  const g = scheduled(); assertSuccess(g.arm({ expiry: g.activation + 3600n })); update(g, g.activation);
  assertSuccess(send(g.svm, [revoke(g.a)], g.a.owner)); expect(g.state()).toBe(3);
  expect(readToken(g.svm, g.a.source).allowance).toBe(0n);
});
test("unknown adjustment schedules fail closed; unchanged multipliers need no window", () => {
  for (const activation of [0n, -1n, 1n, 9223372036854775807n]) {
    const f = scheduled(); assertSuccess(f.arm()); update(f, f.now, activation);
    expect(() => holding(f)).toThrow("Corporate action");
    expect(() => quoteNativeState(f.policy, f.catalog, f.batch)).toThrow("Corporate action");
    expect(failure(f.run(execute(f.snapshot, f.a)))).toContain("CorporateActionWindow");
  }
  const f = scheduled(); assertSuccess(f.arm()); update(f, f.now, 0n, 1);
  expect(holding(f).multiplier).toEqual({ n: 1n, d: 1n });
  expect(quoteNativeState(f.policy, f.catalog, f.batch).outputRaw).not.toBe("0");
  assertSuccess(f.run(execute(f.snapshot, f.a)));
});
