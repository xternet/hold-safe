type Session = { date: string; open: string; close: string };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const ny = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
  day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

function localParts(ms: number): Record<string, string> {
  return Object.fromEntries(ny.formatToParts(ms).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}
function validDate(date: string): void {
  if (!datePattern.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
      new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid session date");
}
export function newYorkTime(date: string, time: string): number {
  validDate(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid session time");
  const naive = Date.parse(`${date}T${time}:00Z`), p = localParts(naive);
  const offset = naive - Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  const result = naive + offset, verified = localParts(result);
  if (`${verified.year}-${verified.month}-${verified.day}` !== date || `${verified.hour}:${verified.minute}` !== time) {
    throw new Error("Ambiguous or nonexistent New York session time");
  }
  return result;
}

export class SessionCalendar {
  private readonly sessions = new Map<string, { open: number; close: number }>();
  constructor(private readonly start: string, private readonly end: string, rows: Session[]) {
    validDate(start); validDate(end);
    if (start > end || !Array.isArray(rows)) throw new Error("Invalid calendar coverage");
    for (const row of rows) {
      validDate(row.date);
      if (row.date < start || row.date > end || this.sessions.has(row.date)) throw new Error("Duplicate/out-of-range calendar session");
      const open = newYorkTime(row.date, row.open), close = newYorkTime(row.date, row.close);
      if (close <= open) throw new Error("Invalid session interval");
      this.sessions.set(row.date, { open, close });
    }
  }
  session(atMs: number): "regular" | "closed" | "unknown" {
    if (!Number.isSafeInteger(atMs)) throw new Error("Invalid session query time");
    const p = localParts(atMs), date = `${p.year}-${p.month}-${p.day}`;
    if (date < this.start || date > this.end) return "unknown";
    const interval = this.sessions.get(date);
    return interval !== undefined && atMs >= interval.open && atMs < interval.close ? "regular" : "closed";
  }
}
