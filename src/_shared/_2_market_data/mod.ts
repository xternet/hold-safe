export function sourceTimestamp(value: string): { ns: bigint; ms: number } {
  if (typeof value !== "string") throw new Error("Source timestamp must be a string");
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (parts === null) throw new Error("Invalid UTC source timestamp");
  const seconds = parts[1]!;
  const epoch = Date.parse(`${seconds}Z`);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString().slice(0, 19) !== seconds) throw new Error("Invalid source calendar date");
  const fraction = parts[2] === undefined ? "000000000" : parts[2].padEnd(9, "0");
  const ns = BigInt(epoch) * 1_000_000n + BigInt(fraction);
  return { ns, ms: Number(ns / 1_000_000n) };
}

export class OrderedSource {
  private readonly latest = new Map<string, bigint>();
  constructor(private readonly maxAgeMs: number) {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error("Invalid source age limit");
  }
  accept(instrument: string, timestamp: string, receivedAtMs: number) {
    const parsed = sourceTimestamp(timestamp);
    if (!Number.isSafeInteger(receivedAtMs) || parsed.ms > receivedAtMs || receivedAtMs - parsed.ms >= this.maxAgeMs) {
      throw new Error(`Stale/future observation: ${instrument}`);
    }
    const previous = this.latest.get(instrument);
    if (previous !== undefined && parsed.ns <= previous) throw new Error(`Replayed/out-of-order observation: ${instrument}`);
    this.latest.set(instrument, parsed.ns);
    return parsed;
  }
}
