import { copyValue } from "../../../_kernel/mod";
import type { Fault, Health, Observer, Outcome, PriceObservation, ReferenceFeed, Subscription } from "../../../_kernel/mod";
import { OrderedSource } from "../../../_shared/_2_market_data/mod";
import { ReconnectingSocket } from "../../../_shared/_3_socket/mod";
import { decodeQuote, type Sessions } from "../_0_decode/mod";
import type { AlpacaCredentials } from "../_2_calendar/mod";

export class AlpacaFeed implements ReferenceFeed {
  readonly id: "alpaca-sip" | "alpaca-iex";
  private readonly observers = new Map<string, Map<number, Observer<PriceObservation>>>();
  private readonly latest = new Map<string, PriceObservation>();
  private readonly order = new OrderedSource(5000);
  private readonly socket: ReconnectingSocket;
  private confirmed = new Set<string>();
  private authenticated = false;
  private started = false;
  private blocked = false;
  private closing: Promise<void> | undefined;
  private sequence = 0;
  private reason = "No active subscriptions";
  constructor(credentials: AlpacaCredentials, private readonly allowed: readonly string[], private readonly calendar: Sessions,
    private readonly log: (fault: Fault) => void, private readonly now = Date.now, endpoint?: string, private readonly feed: "sip" | "iex" = "sip") {
    this.id = `alpaca-${feed}`;
    const expected = `wss://stream.data.alpaca.markets/v2/${feed}`;
    endpoint = endpoint === undefined ? expected : endpoint;
    if (!credentials.key || !credentials.secret) throw new Error("Missing Alpaca credentials");
    if (allowed.length === 0 || new Set(allowed).size !== allowed.length || allowed.some((s) => !/^[A-Z][A-Z0-9.]{0,14}$/.test(s))) throw new Error("Invalid Alpaca coverage");
    const url = new URL(endpoint);
    if (endpoint !== expected && !(url.protocol === "ws:" && url.hostname === "127.0.0.1")) throw new Error("Unsupported stock feed endpoint");
    this.socket = new ReconnectingSocket({ url: endpoint, source: this.id, reconnectMs: 1000, maximumReconnectMs: 30000, idleMs: 60000,
      onOpen: () => { this.authenticated = false; this.confirmed.clear(); this.socket.send(JSON.stringify({ action: "auth", key: credentials.key, secret: credentials.secret })); },
      onFrame: (frame) => this.frame(frame),
      onGap: (reason) => { this.authenticated = false; this.confirmed.clear(); this.invalidate(reason); } });
  }
  async subscribe(instrument: string, observer: Observer<PriceObservation>): Promise<Outcome<Subscription>> {
    if (!this.allowed.includes(instrument) || this.blocked) {
      const error: Fault = { code: this.blocked ? "UNAVAILABLE" : "UNSUPPORTED", message: this.blocked ? this.reason : "Unsupported Alpaca instrument",
        retryable: false, context: { provider: this.id, instrument } };
      this.log(error); return { ok: false, error };
    }
    await this.closing;
    let listeners = this.observers.get(instrument);
    const first = listeners === undefined;
    if (listeners === undefined) { listeners = new Map(); this.observers.set(instrument, listeners); }
    const id = ++this.sequence; listeners.set(id, observer);
    if (!this.started) { this.started = true; this.reason = `Authenticating ${this.feed.toUpperCase()} connection`; this.socket.start(); }
    else if (first && this.authenticated) this.request("subscribe", [instrument]);
    const cached = this.latest.get(instrument), now = this.now();
    if (cached !== undefined && cached.sourceAtMs <= now && now - cached.sourceAtMs < 5000 && this.calendar.session(now) === "regular") this.deliver(observer, { ok: true, value: cached }, instrument);
    let stopped = false;
    return { ok: true, value: { stop: async () => {
      if (stopped) return; stopped = true;
      const active = this.observers.get(instrument);
      if (active === undefined) throw new Error("Subscription registry lost active entry");
      active.delete(id);
      if (active.size === 0) {
        this.observers.delete(instrument); this.latest.delete(instrument); this.confirmed.delete(instrument);
        if (this.authenticated) this.request("unsubscribe", [instrument]);
      }
      if (this.observers.size === 0) {
        this.started = false; this.authenticated = false;
        if (this.closing !== undefined) await this.closing;
        this.closing = this.socket.stop(); await this.closing; this.closing = undefined;
        this.blocked = false; this.reason = "No active subscriptions";
      }
    } } };
  }
  health(): Health {
    const now = this.now(), session = this.calendar.session(now);
    const fresh = this.authenticated && !this.blocked && session === "regular" && this.observers.size > 0 && [...this.observers.keys()].every((key) => {
      const price = this.latest.get(key); return this.confirmed.has(key) && price !== undefined && price.sourceAtMs <= now && now - price.sourceAtMs < 5000;
    });
    const reason = this.blocked ? this.reason : session !== "regular" ? `Stock session ${session}` : this.reason === "Fresh quote" ? "Quote stale or subscription unavailable" : this.reason;
    return { source: this.id, healthy: fresh, checkedAt: now, reason: fresh ? `Fresh ${this.feed.toUpperCase()} quotes` : reason };
  }
  private request(action: "subscribe" | "unsubscribe", quotes: string[]): void {
    if (quotes.length > 0) this.socket.send(JSON.stringify({ action, quotes }));
  }
  private frame(frame: string): void {
    const messages: unknown = JSON.parse(frame);
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 1000) throw new Error("Invalid stock frame");
    for (const row of messages) {
      if (typeof row !== "object" || row === null) throw new Error("Invalid stock message");
      if (row.T === "error") {
        const code = Number.isSafeInteger(row.code) ? String(row.code) : "unknown";
        const retryable = ["404", "406", "407", "500"].includes(code);
        this.authenticated = false; this.confirmed.clear(); this.blocked = !retryable;
        this.invalidate(`Alpaca stream error ${code}`, undefined, retryable);
        if (!retryable) this.closing = this.socket.stop();
        return;
      }
      if (row.T === "success") {
        if (row.msg === "connected") continue;
        if (row.msg !== "authenticated" || this.authenticated) throw new Error("Invalid authentication state");
        this.authenticated = true; this.request("subscribe", [...this.observers.keys()]); continue;
      }
      if (!this.authenticated) throw new Error("Data before authentication");
      if (row.T === "subscription") {
        if (!Array.isArray(row.quotes) || row.quotes.some((s: unknown) => typeof s !== "string" || !this.allowed.includes(s))) throw new Error("Invalid quote subscription acknowledgement");
        this.confirmed = new Set(row.quotes);
        for (const key of this.observers.keys()) if (!this.confirmed.has(key)) this.invalidate("Quote subscription not confirmed", key);
        continue;
      }
      if (row.T !== "q" || typeof row.S !== "string") throw new Error("Unexpected stock message");
      const instrument: string = row.S;
      if (!this.observers.has(instrument)) {
        this.log({ code: "UNAVAILABLE", message: "Ignored quote without active subscription", retryable: true,
          context: { provider: this.id, instrument, receivedAtMs: String(this.now()) } });
        continue;
      }
      if (!this.confirmed.has(instrument)) { this.invalidate("Quote before subscription confirmation", instrument); continue; }
      try {
        const price = decodeQuote(row, this.order, this.calendar, this.now(), this.feed);
        this.latest.set(instrument, price); this.reason = "Fresh quote";
        for (const observer of this.observers.get(instrument)!.values()) this.deliver(observer, { ok: true, value: price }, instrument);
      } catch (error) {
        const sourceTime = typeof row.t === "string" && row.t.length <= 35 ? row.t : "invalid";
        this.invalidate(error instanceof Error ? error.message : "Invalid stock quote", instrument, true, sourceTime);
      }
    }
  }
  private invalidate(reason: string, instrument?: string, retryable = true, sourceTime?: string): void {
    this.reason = reason;
    const keys = instrument === undefined ? [...this.observers.keys()] : [instrument];
    const context: Record<string, string> = { provider: this.id, instruments: keys.join(","), receivedAtMs: String(this.now()) };
    if (sourceTime !== undefined) context.sourceTime = sourceTime;
    const error: Fault = { code: "UNAVAILABLE", message: reason, retryable, context }; this.log(error);
    for (const key of keys) {
      this.latest.delete(key);
      const listeners = this.observers.get(key);
      if (listeners !== undefined) for (const observer of listeners.values()) this.deliver(observer, { ok: false, error }, key);
    }
  }
  private deliver(observer: Observer<PriceObservation>, event: Outcome<PriceObservation>, instrument: string): void {
    try { observer(copyValue(event)); }
    catch { this.log({ code: "FAILED", message: "Feed observer failed", retryable: false, context: { provider: this.id, instrument } }); }
  }
}
