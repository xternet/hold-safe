import { expect, test } from "bun:test";
import { sourceTimestamp, OrderedSource } from "./mod";

test("timestamps retain nanosecond ordering and reject invalid calendar dates", () => {
  const a = sourceTimestamp("2026-09-24T14:00:00.123000001Z");
  const b = sourceTimestamp("2026-09-24T14:00:00.123000002Z");
  expect(b.ns - a.ns).toBe(1n); expect(a.ms).toBe(b.ms);
  expect(() => sourceTimestamp("2026-02-30T14:00:00Z")).toThrow();
  expect(() => sourceTimestamp("2026-09-24T14:00:00")).toThrow();
});

test("replayed, out-of-order, stale and future ticks never advance accepted state", () => {
  const source = new OrderedSource(5000), now = Date.parse("2026-09-24T14:00:01Z");
  source.accept("AAPL", "2026-09-24T14:00:00.123000002Z", now);
  for (const stamp of ["2026-09-24T14:00:00.123000001Z", "2026-09-24T14:00:00.123000002Z",
    "2026-09-24T13:59:50Z", "2026-09-24T14:00:02Z"]) expect(() => source.accept("AAPL", stamp, now)).toThrow();
  expect(source.accept("AAPL", "2026-09-24T14:00:00.123000003Z", now).ms).toBe(now - 877);
  source.accept("USDC/USD", "2026-09-24T14:00:00Z", now);
});
