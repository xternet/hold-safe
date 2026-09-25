import { expect, test } from "bun:test";
import { decodeQuote } from "./mod";
import { OrderedSource } from "../../../_shared/_2_market_data/mod";
import { SessionCalendar } from "../_1_sessions/mod";

const calendar = new SessionCalendar("2026-09-23", "2026-09-24", [{ date: "2026-09-23", open: "09:30", close: "16:00" }]);
const at = Date.parse("2026-09-23T15:00:00Z");
const quote = { T: "q", S: "AAPL", bp: 250.01, ap: 250.02, bs: 2, as: 3, c: ["R"], t: "2026-09-23T15:00:00.000000001Z" };
test("SIP decoder preserves exact prices and round-lot sizes within verified sessions", () => {
  const value = decodeQuote(quote, new OrderedSource(5000), calendar, at + 1);
  expect(value.bidUsd).toEqual({ n: 25001n, d: 100n });
  expect(value.bidSize).toEqual({ n: 2n, d: 1n });
  expect(value.sizeUnit).toBe("round_lots"); expect(value.coverage).toBe("consolidated");
  expect(value.session).toBe("regular"); expect(value.provider).toBe("alpaca-sip");
});
test("invalid/nonfirm/closed quotes do not advance ordering or become eligible", () => {
  const order = new OrderedSource(5000);
  for (const patch of [{ bp: 0 }, { ap: 240 }, { bs: -1 }, { as: 0 }, { bs: 0.5 }, { c: ["H"] }, { c: [] }, { T: "t" }, { S: "*" }]) {
    expect(() => decodeQuote({ ...quote, ...patch }, order, calendar, at + 1)).toThrow();
  }
  expect(decodeQuote(quote, order, calendar, at + 1).instrument).toBe("AAPL");
  expect(() => decodeQuote(quote, order, calendar, at + 1)).toThrow(/Replayed/);
  for (const timestamp of ["2026-09-23T20:00:00Z", "2026-09-24T15:00:00Z", "2026-09-25T15:00:00Z"]) {
    expect(() => decodeQuote({ ...quote, t: timestamp }, new OrderedSource(5000), calendar, Date.parse(timestamp))).toThrow(/session/);
  }
  expect(() => decodeQuote({ ...quote, t: "2026-09-23T19:59:59Z" }, new OrderedSource(5000), calendar, Date.parse("2026-09-23T20:00:00Z"))).toThrow(/session/);
});
test("IEX observations explicitly retain venue provenance and stale rejection", () => {
  const value = decodeQuote(quote, new OrderedSource(5000), calendar, at + 1, "iex");
  expect(value.provider).toBe("alpaca-iex"); expect(value.coverage).toBe("venue");
  expect(value.bidUsd).toEqual({ n: 25001n, d: 100n });
  expect(() => decodeQuote(quote, new OrderedSource(5000), calendar, at + 5000, "iex")).toThrow();
});
