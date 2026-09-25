import type { Fault } from "../../../_kernel/mod";
import { SessionCalendar } from "../_1_sessions/mod";

export type AlpacaCredentials = { key: string; secret: string };
export class LiveCalendar {
  private calendar: SessionCalendar | undefined;
  private loadedAt: number | undefined;
  private pending: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private request: AbortController | undefined;
  constructor(private readonly credentials: AlpacaCredentials, private readonly log: (fault: Fault) => void,
    private readonly now = Date.now, private readonly origin = "https://api.alpaca.markets") {
    if (!credentials.key || !credentials.secret) throw new Error("Missing Alpaca credentials");
    const url = new URL(origin);
    if (url.origin !== "https://api.alpaca.markets" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) throw new Error("Unsupported calendar endpoint");
  }
  session(atMs: number): "regular" | "closed" | "unknown" {
    const now = this.now();
    if (this.calendar === undefined || this.loadedAt === undefined || now < this.loadedAt || now - this.loadedAt >= 3600000) return "unknown";
    return this.calendar.session(atMs);
  }
  async start(): Promise<void> {
    if (this.timer !== undefined) throw new Error("Calendar already started");
    this.timer = setInterval(() => { void this.refresh(); }, 60000);
    await this.refresh();
  }
  refresh(): Promise<void> {
    if (this.pending !== undefined) return this.pending;
    if (this.timer !== undefined && this.loadedAt !== undefined && this.now() >= this.loadedAt && this.now() - this.loadedAt < 1800000) return Promise.resolve();
    this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }
  private async load(): Promise<void> {
    const now = this.now(), day = 86400000;
    const start = new Date(now - day).toISOString().slice(0, 10), end = new Date(now + 8 * day).toISOString().slice(0, 10);
    const controller = new AbortController(); this.request = controller;
    const timeout = setTimeout(() => controller.abort(), 3000);
    let status = "transport";
    try {
      const response = await fetch(`${this.origin}/v2/calendar?start=${start}&end=${end}`, {
        headers: { "APCA-API-KEY-ID": this.credentials.key, "APCA-API-SECRET-KEY": this.credentials.secret },
        signal: controller.signal, redirect: "error",
      });
      status = String(response.status);
      if (!response.ok) { await response.body?.cancel(); throw new Error("Calendar HTTP failure"); }
      const body = await response.text();
      if (body.length > 65536) throw new Error("Oversized calendar");
      const rows: unknown = JSON.parse(body);
      if (!Array.isArray(rows) || rows.length > 10 || rows.some((row) => typeof row !== "object" || row === null ||
          typeof row.date !== "string" || typeof row.open !== "string" || typeof row.close !== "string")) throw new Error("Invalid calendar payload");
      this.calendar = new SessionCalendar(start, end, rows); this.loadedAt = this.now();
    } catch {
      this.calendar = undefined; this.loadedAt = undefined;
      this.log({ code: "UNAVAILABLE", message: "Alpaca calendar unavailable or invalid", retryable: true,
        context: { provider: "alpaca-calendar", status, receivedAtMs: String(this.now()), start, end } });
    } finally { clearTimeout(timeout); this.request = undefined; }
  }
  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    if (this.request !== undefined) this.request.abort();
    await this.pending;
    this.calendar = undefined; this.loadedAt = undefined;
  }
}
