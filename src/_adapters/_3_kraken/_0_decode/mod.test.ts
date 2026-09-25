import { expect, test } from "bun:test";
import { decodeTicker } from "./mod";
import { OrderedSource } from "../../../_shared/_2_market_data/mod";

const now = Date.parse("2026-09-24T14:00:00.500Z");
const ticker = () => ({ symbol: "USDC/USD", bid: 0.9998, ask: 0.9999, bid_qty: 2000000.5,
  ask_qty: 1800000, timestamp: "2026-09-24T14:00:00.123456Z" });
test("Kraken ticker preserves actual USD quote and base-asset size", () => {
  const price = decodeTicker(ticker(), new OrderedSource(5000), now);
  expect(price.bidUsd).toEqual({ n: 4999n, d: 5000n });
  expect(price.bidSize).toEqual({ n: 4000001n, d: 2n });
  expect(price.sizeUnit).toBe("base_asset"); expect(price.session).toBe("continuous");
});
test("invalid ticker does not advance source ordering", () => {
  const order = new OrderedSource(5000);
  for (const change of [{ bid: 0 }, { ask: 0.5 }, { bid_qty: -1 }, { timestamp: "bad" }, { symbol: "USDC/EUR" }]) {
    expect(() => decodeTicker({ ...ticker(), ...change }, order, now)).toThrow();
  }
  expect(decodeTicker(ticker(), order, now).instrument).toBe("USDC/USD");
  expect(() => decodeTicker(ticker(), order, now)).toThrow();
});
