import { expect, test } from "bun:test";
import { SessionCalendar, newYorkTime } from "./mod";

test("New York sessions handle DST and early closes without weekday guesses", () => {
  expect(newYorkTime("2026-01-05", "09:30")).toBe(Date.parse("2026-01-05T14:30:00Z"));
  expect(newYorkTime("2026-07-06", "09:30")).toBe(Date.parse("2026-07-06T13:30:00Z"));
  const calendar = new SessionCalendar("2026-11-26", "2026-11-28", [
    { date: "2026-11-27", open: "09:30", close: "13:00" },
  ]);
  expect(calendar.session(Date.parse("2026-11-26T16:00:00Z"))).toBe("closed");
  expect(calendar.session(Date.parse("2026-11-27T14:30:00Z"))).toBe("regular");
  expect(calendar.session(Date.parse("2026-11-27T18:00:00Z"))).toBe("closed");
  expect(calendar.session(Date.parse("2026-11-30T16:00:00Z"))).toBe("unknown");
});

test("calendar rejects malformed dates, duplicate sessions and inverted intervals", () => {
  expect(() => newYorkTime("2026-02-30", "09:30")).toThrow();
  expect(() => newYorkTime("2026-01-05", "25:00")).toThrow();
  const row = { date: "2026-01-05", open: "09:30", close: "16:00" };
  expect(() => new SessionCalendar(row.date, row.date, [row, row])).toThrow();
  expect(() => new SessionCalendar(row.date, row.date, [{ ...row, close: "09:00" }])).toThrow();
});
