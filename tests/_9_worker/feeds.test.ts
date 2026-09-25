import { expect, test } from "bun:test";
import { type Observer, type Outcome, type PriceObservation, type HoldingObservation, type ChainReader, type ReferenceFeed } from "../../src/_kernel/mod";
import { riskFixture } from "../../src/_2_risk/_test/mod";
import { createFeedMonitor } from "../../src/_1_feeds/mod";

// Controlled adapter events; this tests shared subscription/gap behavior, not
// source-provider entitlement or native quote compatibility.
async function fixture() {
  const f = await riskFixture(); let now = f.start, stops = 0, rejectHolding = false;
  let quoteWait: Promise<void> | null = null;
  const listeners = new Map<string, Set<Observer<PriceObservation>>>(), holdings = new Set<Observer<HoldingObservation>>();
  const faults: unknown[] = [];
  const feed = (id: string): ReferenceFeed => ({ id, health: () => ({ source: id, healthy: true, checkedAt: now, reason: "fixture" }),
    subscribe: async (instrument, observer) => {
      let group = listeners.get(instrument); if (group === undefined) { group = new Set(); listeners.set(instrument, group); }
      group.add(observer); return { ok: true, value: { stop: async () => { group.delete(observer); stops++; } } };
    } });
  const chain: ChainReader = { chain: f.policy.chain, verifyNetwork: async () => ({ ok: true, value: undefined }), readHolding: async () => f.input(now).holding,
    health: () => ({ source: "fixture", healthy: true, checkedAt: now, reason: "fixture" }),
    subscribeHolding: async (_policy, observer) => {
      if (rejectHolding) return { ok: false, error: { code: "UNAVAILABLE", message: "Controlled subscription failure", retryable: true, context: {} } };
      holdings.add(observer); return { ok: true, value: { stop: async () => { holdings.delete(observer); stops++; } } }; } };
  const venue = { id: f.policy.coverage.venue, quote: async () => { if (quoteWait !== null) await quoteWait; return f.input(now).quote; }, validateRoute: async () => ({ ok: true as const, value: undefined }) };
  const monitor = createFeedMonitor({ feeds: new Map([["stocks", feed("stocks")], ["usd", feed("usd")]]), chain, venue,
    session: () => "regular", now: () => now, log: fault => faults.push(fault) });
  function emit() {
    const input = f.input(now);
    for (const observer of listeners.get("AAPL")!) observer(input.reference);
    for (const observer of listeners.get("USDC/USD")!) observer(input.output);
    for (const observer of holdings) observer(input.holding);
  }
  return { ...f, monitor, faults, emit, listeners, stops: () => stops, setTime: (time: number) => { now = time; },
    rejectHolding: () => { rejectHolding = true; },
    pauseQuote: () => { const gate = Promise.withResolvers<void>(); quoteWait = gate.promise; return () => { gate.resolve(); quoteWait = null; }; },
    async snapshot() { return monitor.snapshot(f.policy, f.input(now).authorization); } };
}
test("shared feed monitor isolates policies, shares duplicate watchers and releases every subscription", async () => {
  const f = await fixture(); const a = await f.monitor.watch(f.policy), b = await f.monitor.watch(f.policy);
  if (!a.ok || !b.ok) throw new Error("Watch failed");
  expect(f.listeners.get("AAPL")!.size).toBe(1);
  expect((await f.snapshot()).reference.ok).toBe(false);
  f.emit(); const snapshot = await f.snapshot();
  expect(snapshot.reference.ok).toBe(true); expect(snapshot.holding.ok).toBe(true); expect(snapshot.quote.ok).toBe(true);
  if (snapshot.reference.ok) snapshot.reference.value.bidUsd = { n: 0n, d: 1n };
  const next = await f.snapshot(); if (!next.reference.ok) throw new Error("Reference missing");
  expect(next.reference.value.bidUsd.n).toBe(200n);
  await a.value.stop(); expect(f.stops()).toBe(0); await b.value.stop(); expect(f.stops()).toBe(3);
  await expect(f.snapshot()).rejects.toThrow();
});
test("feed failures increment gap epochs and cannot silently retain a previous quote", async () => {
  const f = await fixture(), watch = await f.monitor.watch(f.policy); if (!watch.ok) throw new Error("Watch failed");
  try {
    f.emit(); const before = await f.snapshot();
    const failure: Outcome<PriceObservation> = { ok: false, error: { code: "UNAVAILABLE", message: "Disconnected", retryable: true, context: {} } };
    for (const observer of f.listeners.get("AAPL")!) observer(failure);
    const gap = await f.snapshot(); expect(gap.gapEpoch).toBeGreaterThan(before.gapEpoch); expect(gap.reference.ok).toBe(false);
    f.setTime(f.start + 1000); f.emit();
    const restored = await f.snapshot(); expect(restored.reference.ok).toBe(true); expect(restored.gapEpoch).toBe(gap.gapEpoch);
    expect(f.faults.length).toBeGreaterThan(0);
  } finally { await watch.value.stop(); }
});


test("a feed gap during an outstanding quote invalidates that snapshot", async () => {
  const f = await fixture(), watch = await f.monitor.watch(f.policy); if (!watch.ok) throw new Error("Watch failed");
  try {
    f.emit(); const release = f.pauseQuote(), pending = f.snapshot();
    await Bun.sleep(5);
    for (const observer of f.listeners.get("AAPL")!) observer({ ok: false,
      error: { code: "UNAVAILABLE", message: "Controlled in-flight gap", retryable: true, context: {} } });
    f.emit(); release();
    const snapshot = await pending; expect(snapshot.reference.ok).toBe(true); expect(snapshot.quote.ok).toBe(false);
    if (!snapshot.quote.ok) expect(snapshot.quote.error.context.source).toBe("feed-gap-during-quote");
  } finally { await watch.value.stop(); }
});

test("partially failed subscription setup closes every successfully opened stream", async () => {
  const f = await fixture(); f.rejectHolding();
  expect((await f.monitor.watch(f.policy)).ok).toBe(false);
  expect(f.stops()).toBe(2); expect(f.listeners.get("AAPL")!.size).toBe(0);
  expect(f.listeners.get("USDC/USD")!.size).toBe(0); expect(f.faults.length).toBeGreaterThan(0);
});
