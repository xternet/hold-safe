import { compare, decimal, type PriceObservation } from "../../../_kernel/mod";
import { OrderedSource } from "../../../_shared/_2_market_data/mod";

function positive(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) throw new Error("Invalid market number");
  return decimal(String(value));
}
export function decodeTicker(value: unknown, order: OrderedSource, receivedAtMs: number): PriceObservation {
  if (typeof value !== "object" || value === null) throw new Error("Invalid ticker object");
  const row = value as Record<string, unknown>;
  if (typeof row.symbol !== "string" || !/^[A-Z0-9]+\/USD$/.test(row.symbol) || typeof row.timestamp !== "string") throw new Error("Invalid USD ticker identity/time");
  const bidUsd = positive(row.bid), askUsd = positive(row.ask), bidSize = positive(row.bid_qty), askSize = positive(row.ask_qty);
  if (compare(bidUsd, askUsd) > 0) throw new Error("Crossed ticker quote");
  const source = order.accept(row.symbol, row.timestamp, receivedAtMs);
  return { id: crypto.randomUUID(), provider: "kraken-usd", instrument: row.symbol, coverage: "venue",
    bidUsd, askUsd, bidSize, askSize, sizeUnit: "base_asset", sourceAtMs: source.ms, receivedAtMs, session: "continuous" };
}
