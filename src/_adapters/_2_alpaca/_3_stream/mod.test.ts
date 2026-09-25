import { expect, test } from "bun:test";
import { AlpacaFeed } from "./mod";
import { SessionCalendar } from "../_1_sessions/mod";
import { fixture } from "../../../_shared/_3_socket/_test/mod";
import type { Fault, PriceObservation, Subscription } from "../../../_kernel/mod";

const at = Date.parse("2026-09-23T15:00:01Z");
const calendar = new SessionCalendar("2026-09-23", "2026-09-23", [{ date: "2026-09-23", open: "09:30", close: "16:00" }]);
test("SIP authentication and confirmed subscriptions serve two policies through one connection", async () => {
  const server = await fixture("alpaca"), faults: Fault[] = [], prices: PriceObservation[] = [], stops: Subscription[] = [];
  let now = at;
  const feed = new AlpacaFeed({ key: "local-key", secret: "local-secret" }, ["AAPL"], calendar, (f) => faults.push(f), () => now, server.url);
  let notify!: () => void;
  const done = new Promise<void>((resolve) => { notify = resolve; }), timeout = setTimeout(notify, 2000);
  try {
    for (let i = 0; i < 2; i++) {
      const result = await feed.subscribe("AAPL", (event) => { if (event.ok) { prices.push(event.value); if (prices.length === 2) notify(); } });
      if (!result.ok) throw new Error(result.error.message); stops.push(result.value);
    }
    await done;
    expect(prices.length).toBe(2); expect(server.connections()).toBe(1); expect(server.subscriptions()).toBe(1);
    expect(feed.health().healthy).toBe(true);
    now += 5000; expect(feed.health().healthy).toBe(false);
    now = Date.parse("2026-09-23T20:00:00Z"); expect(feed.health().reason).toContain("session");
    expect(faults).toEqual([]);
  } finally { clearTimeout(timeout); for (const stop of stops) await stop.stop(); await server.stop(); }
});
test("SIP entitlement failure disables the feed, redacts provider text and does not reconnect in a loop", async () => {
  const server = await fixture("alpaca-denied"), faults: Fault[] = [];
  const feed = new AlpacaFeed({ key: "local-key", secret: "local-secret" }, ["AAPL"], calendar, (f) => faults.push(f), () => at, server.url);
  let notify!: () => void;
  const done = new Promise<void>((resolve) => { notify = resolve; }), timeout = setTimeout(notify, 2000);
  let stop: Subscription | undefined;
  try {
    const result = await feed.subscribe("AAPL", (event) => { if (!event.ok) notify(); });
    if (!result.ok) throw new Error(result.error.message); stop = result.value;
    await done; await Bun.sleep(1100);
    expect(feed.health().healthy).toBe(false); expect(feed.health().reason).toContain("409");
    expect(faults[0]!.retryable).toBe(false); expect(server.connections()).toBe(1);
    expect(JSON.stringify(faults)).not.toContain("local-secret");
  } finally { clearTimeout(timeout); if (stop !== undefined) await stop.stop(); await server.stop(); }
});
test("SIP disconnect emits a gap and authenticates/subscribes again before fresh delivery", async () => {
  const server = await fixture("alpaca-reconnect"), faults: Fault[] = [], prices: PriceObservation[] = [];
  const feed = new AlpacaFeed({ key: "local-key", secret: "local-secret" }, ["AAPL"], calendar, (f) => faults.push(f), () => at, server.url);
  let notify!: () => void;
  const done = new Promise<void>((resolve) => { notify = resolve; }), timeout = setTimeout(notify, 2500);
  let stop: Subscription | undefined;
  try {
    const result = await feed.subscribe("AAPL", (event) => { if (event.ok) { prices.push(event.value); if (prices.length === 2) notify(); } });
    if (!result.ok) throw new Error(result.error.message); stop = result.value;
    await done;
    expect(prices.length).toBe(2); expect(faults.length).toBeGreaterThan(0);
    expect(server.connections()).toBe(2); expect(server.subscriptions()).toBe(2); expect(feed.health().healthy).toBe(true);
  } finally { clearTimeout(timeout); if (stop !== undefined) await stop.stop(); await server.stop(); }
});
test("free IEX stream is explicit, labelled, and cannot silently use the SIP endpoint", async () => {
  const server = await fixture("alpaca"), prices: PriceObservation[] = [];
  const feed = new AlpacaFeed({ key: "local-key", secret: "local-secret" }, ["AAPL"], calendar,
    () => {}, () => at, server.url, "iex");
  let subscription: Subscription | undefined;
  try {
    const result = await feed.subscribe("AAPL", event => { if (event.ok) prices.push(event.value); });
    if (!result.ok) throw new Error(result.error.message); subscription = result.value;
    for (let i = 0; i < 40 && prices.length === 0; i++) await Bun.sleep(25);
    expect(prices.length).toBe(1); expect(feed.id).toBe("alpaca-iex");
    expect(prices[0]!.coverage).toBe("venue"); expect(prices[0]!.provider).toBe(feed.id);
    expect(feed.health().reason).toBe("Fresh IEX quotes");
    expect(() => new AlpacaFeed({ key: "k", secret: "s" }, ["AAPL"], calendar, () => {}, () => at,
      "wss://stream.data.alpaca.markets/v2/sip", "iex")).toThrow();
  } finally { if (subscription !== undefined) await subscription.stop(); await server.stop(); }
});
