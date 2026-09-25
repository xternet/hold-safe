import { expect, test } from "bun:test";
import { KrakenFeed } from "./mod";
import { fixture } from "../../../_shared/_3_socket/_test/mod";
import type { Fault, PriceObservation, Subscription } from "../../../_kernel/mod";

test("two policies share one actual upstream subscription and receive isolated observations", async () => {
  const server = await fixture("kraken"), faults: Fault[] = [], observations: PriceObservation[] = [];
  const feed = new KrakenFeed(["USDC/USD"], (fault) => faults.push(fault), Date.now, server.url);
  let notify!: () => void;
  const done = new Promise<void>((resolve) => { notify = resolve; });
  const stops: Subscription[] = [];
  const timeout = setTimeout(notify, 1500);
  try {
    for (let index = 0; index < 2; index++) {
      const result = await feed.subscribe("USDC/USD", (event) => {
        if (!event.ok) return;
        if (index === 0) (event.value.bidUsd as { n: bigint }).n = 1n;
        observations.push(event.value); if (observations.length === 2) notify();
      });
      if (!result.ok) throw new Error(result.error.message);
      stops.push(result.value);
    }
    await done;
    expect(observations.length).toBe(2);
    expect(observations[1]!.bidUsd.n).toBe(4999n);
    expect(server.connections()).toBe(1); expect(server.subscriptions()).toBe(1);
    expect(feed.health().healthy).toBe(true);
    await stops[0]!.stop(); expect(feed.health().healthy).toBe(true);
    await stops[1]!.stop(); expect(feed.health().healthy).toBe(false);
    expect(faults).toEqual([]);
  } finally {
    clearTimeout(timeout); for (const subscription of stops) await subscription.stop(); await server.stop();
  }
});
