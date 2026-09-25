import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import { ExtensionType } from "@solana/spl-token";
import { decodeHolding } from "../../src/_adapters/_0_solana/_0_reader/_0_decode/mod";
import { quoteFixture } from "../_6_quotes/_shared/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";

function fixture() {
  const f = quoteFixture(); assertSuccess(f.arm());
  const source = f.svm.getAccount(address(f.policy.source));
  if (!source.exists) throw new Error("Missing native holding fixture");
  const accounts = new Map(f.batch.accounts);
  accounts.set(f.policy.source, { data: Buffer.from(source.data), owner: new PublicKey(source.programAddress), lamports: Number(source.lamports), executable: source.executable });
  return { ...f, accounts };
}
function extension(data: Buffer, type: ExtensionType): number {
  for (let offset = 166; offset + 4 <= data.length; offset += 4 + data.readUInt16LE(offset + 2)) {
    if (data.readUInt16LE(offset) === type) return offset + 4;
  }
  throw new Error("Missing fixture extension");
}
test("holding reads preserve native raw balance, PDA allowance and active multiplier", () => {
  const f = fixture();
  const value = decodeHolding(f.policy, f.catalog, f.accounts, f.batch.slot, f.batch.observedAtMs);
  expect(value.balanceRaw).toBe(f.balances()[0]!.toString());
  expect(value.allowanceRaw).toBe(f.a.amount.toString()); expect(value.delegate).toBe(f.a.policy.toBase58());
  expect(value.sourceAtMs).toBe(f.batch.observedAtMs); expect(value.asset).toEqual(f.policy.input);
  const mint = f.accounts.get(f.policy.input.address)!;
  const bytes = Buffer.from(mint.data), offset = extension(bytes, ExtensionType.ScaledUiAmountConfig);
  const activation = (BigInt(f.batch.observedAtMs / 1000) / 86400n + 2n) * 86400n + 1800n;
  f.policy.expiresAt = Number(activation + 3600n);
  bytes.writeDoubleLE(1.5, offset + 32); bytes.writeBigInt64LE(activation, offset + 40); bytes.writeDoubleLE(2, offset + 48);
  f.accounts.set(f.policy.input.address, { ...mint, data: bytes });
  expect(decodeHolding(f.policy, f.catalog, f.accounts, f.batch.slot, f.batch.observedAtMs).multiplier).toEqual({ n: 3n, d: 2n });
  const clock = f.accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!, data = Buffer.from(clock.data);
  data.writeBigInt64LE(activation + 300n, 32);
  f.accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), { ...clock, data });
  expect(decodeHolding(f.policy, f.catalog, f.accounts, f.batch.slot, Number(activation + 300n) * 1000).multiplier).toEqual({ n: 2n, d: 1n });
});
test("holding decoder rejects stale/foreign/incoherent/frozen/paused state", () => {
  const f = fixture(), read = (accounts: Map<string, AccountInfo<Buffer>>, slot = f.batch.slot, at = f.batch.observedAtMs) => decodeHolding(f.policy, f.catalog, accounts, slot, at);
  expect(() => read(f.accounts, f.batch.slot, f.batch.observedAtMs + 5000)).toThrow(/clock/);
  expect(() => read(f.accounts, f.batch.slot + 1)).toThrow(/slot/);
  expect(() => read(f.accounts, f.batch.slot, f.batch.observedAtMs - 1)).toThrow(/clock/);
  for (const [key, edit] of [
    [f.policy.source, (data: Buffer) => data.writeUInt8(2, 108)],
    [f.policy.input.address, (data: Buffer) => data.writeUInt8(1, extension(data, ExtensionType.PausableConfig) + 32)],
  ] as const) {
    const accounts = new Map(f.accounts), original = accounts.get(key)!, data = Buffer.from(original.data); edit(data);
    accounts.set(key, { ...original, data }); expect(() => read(accounts)).toThrow();
  }
  const accounts = new Map(f.accounts), clock = accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58())!;
  accounts.set(SYSVAR_CLOCK_PUBKEY.toBase58(), { ...clock, owner: f.a.owner.publicKey }); expect(() => read(accounts)).toThrow();
  accounts.delete(f.policy.source); expect(() => read(accounts)).toThrow();
});
