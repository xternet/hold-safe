import { expect, test } from "bun:test";
import { policyDigest } from "../../src/_kernel/mod";
import { quoteNativeState } from "../../src/_adapters/_0_solana/_venues/_0_raydium/_0_math/mod";
import { QuoteBook } from "../../src/_adapters/_0_solana/_venues/_0_raydium/_2_book/mod";
import { quoteFixture } from "./_shared/mod";
import { assertSuccess } from "../_0_permissions/_0_fixture/mod";
import { execute } from "../_0_permissions/_shared/mod";

test("integer native quote equals actual CLMM proceeds at several input sizes", () => {
  for (const amount of [100_000n, 1_000_000n, 5_000_000n]) {
    const f = quoteFixture(); f.policy.amountRaw = amount.toString(); f.a.amount = amount;
    const quote = quoteNativeState(f.policy, f.catalog, f.batch);
    assertSuccess(f.arm()); assertSuccess(f.run(execute(f.snapshot, f.a)));
    expect(quote.outputRaw).toBe(f.balances()[2]!.toString());
    expect(BigInt(quote.minimumOutputRaw)).toBe(BigInt(quote.outputRaw) * 9900n / 10000n);
    expect(quote.ticks.length).toBeGreaterThan(0);
    expect(quote.sampleOutputRaw).not.toBe("0");
  }
});

test("quote requires coherent identities, supported profiles and fresh native clock", () => {
  const f = quoteFixture();
  expect(() => quoteNativeState(f.policy, f.catalog, { ...f.batch, programVersion: "changed" })).toThrow();
  expect(() => quoteNativeState(f.policy, f.catalog, { ...f.batch, observedAtMs: f.batch.observedAtMs + 60_000 })).toThrow();
  expect(() => quoteNativeState(f.policy, f.catalog, { ...f.batch, observedAtMs: f.batch.observedAtMs - 60_000 })).toThrow();
  expect(() => quoteNativeState(f.policy, f.catalog, { ...f.batch, observedAtMs: f.batch.observedAtMs - 1 })).toThrow();
  const strict = structuredClone(f.policy); strict.rule.maxAgeMs = 500;
  expect(() => quoteNativeState(strict, f.catalog, { ...f.batch, observedAtMs: f.batch.observedAtMs + 1000 })).toThrow();
  expect(() => quoteNativeState({ ...f.policy, amountRaw: "18446744073709551616" }, f.catalog, f.batch)).toThrow();
  expect(() => quoteNativeState({ ...f.policy, amountRaw: "1" }, f.catalog, f.batch)).toThrow();
  const accounts = new Map(f.batch.accounts); accounts.delete(f.policy.input.address);
  expect(() => quoteNativeState(f.policy, f.catalog, { ...f.batch, accounts })).toThrow();
  const changed = structuredClone(f.policy); changed.coverage.program = f.a.owner.publicKey.toBase58();
  expect(() => quoteNativeState(changed, f.catalog, f.batch)).toThrow();
});

test("quote book rejects changed amount, domain, route, context, expiry and unissued quotes", async () => {
  const f = quoteFixture(); let now = f.batch.observedAtMs;
  const book = new QuoteBook(() => now, 2);
  const native = quoteNativeState(f.policy, f.catalog, f.batch);
  const digest = await policyDigest(f.policy);
  const quote = book.issue(f.policy, digest, native);
  expect(book.validate(f.policy, digest, quote)).toEqual(native);
  for (const change of [{ amountRaw: "123456" }, { chain: { ...f.policy.chain, reference: "wrong" } },
    { routeId: "foreign" }, { recipient: f.a.delegate.publicKey.toBase58() }]) {
    const policy = { ...f.policy, ...change };
    expect(() => book.validate(policy, digest, quote)).toThrow();
  }
  for (const changed of [{ ...quote, id: "unissued" }, { ...quote, minimumOutputRaw: "0" },
    { ...quote, context: { ...quote.context, serialized: "{}" } },
    { ...quote, output: { ...quote.output, raw: "99999999999" } }]) {
    expect(() => book.validate(f.policy, digest, changed)).toThrow();
  }
  book.issue(f.policy, digest, native);
  expect(() => book.issue(f.policy, digest, native)).toThrow("capacity");
  now += 2501;
  expect(() => book.validate(f.policy, digest, quote)).toThrow("expired");
  expect(() => book.issue(f.policy, digest, native)).toThrow("stale");
});

test("a quote cannot outlive the owner's maximum source age", async () => {
  const f = quoteFixture(); f.policy.rule.maxAgeMs = 1000;
  let now = f.batch.observedAtMs;
  const native = quoteNativeState(f.policy, f.catalog, f.batch), digest = await policyDigest(f.policy);
  const book = new QuoteBook(() => now);
  const quote = book.issue(f.policy, digest, native);
  expect(quote.sourceAtMs).toBe(native.sourceAtMs);
  now += 1001;
  expect(() => book.validate(f.policy, digest, quote)).toThrow("expired");
});
