import { compare, decimal, type PriceObservation } from "../../../_kernel/mod";
import { OrderedSource, sourceTimestamp } from "../../../_shared/_2_market_data/mod";

export type Sessions = { session(atMs: number): "regular" | "closed" | "unknown" };
function positive(value: unknown, integer = false) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER ||
      (integer && !Number.isSafeInteger(value))) throw new Error("Invalid stock quote number");
  return decimal(String(value));
}
export function decodeQuote(value: unknown, order: OrderedSource, calendar: Sessions, receivedAtMs: number, feed: "sip" | "iex" = "sip"): PriceObservation {
  if (typeof value !== "object" || value === null) throw new Error("Invalid quote object");
  const row = value as Record<string, unknown>;
  if (row.T !== "q" || typeof row.S !== "string" || !/^[A-Z][A-Z0-9.]{0,14}$/.test(row.S) || typeof row.t !== "string") throw new Error("Invalid stock quote identity/time");
  if (!Array.isArray(row.c) || row.c.length !== 1 || row.c[0] !== "R") throw new Error("Unsupported stock quote condition");
  const bidUsd = positive(row.bp), askUsd = positive(row.ap), bidSize = positive(row.bs, true), askSize = positive(row.as, true);
  if (compare(bidUsd, askUsd) > 0) throw new Error("Crossed stock quote");
  const source = sourceTimestamp(row.t);
  if (calendar.session(source.ms) !== "regular" || calendar.session(receivedAtMs) !== "regular") throw new Error("Stock quote outside verified regular session");
  order.accept(row.S, row.t, receivedAtMs);
  return { id: crypto.randomUUID(), provider: `alpaca-${feed}`, instrument: row.S, coverage: feed === "sip" ? "consolidated" : "venue",
    bidUsd, askUsd, bidSize, askSize, sizeUnit: "round_lots", sourceAtMs: source.ms, receivedAtMs, session: "regular" };
}
