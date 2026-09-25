import { copyValue } from "../../../_kernel/mod";
import type { Fault, Health, Observer, Outcome, PriceObservation, ReferenceFeed, Subscription } from "../../../_kernel/mod";
import { OrderedSource } from "../../../_shared/_2_market_data/mod";
import { ReconnectingSocket } from "../../../_shared/_3_socket/mod";
import { decodeTicker } from "../_0_decode/mod";

export class KrakenFeed implements ReferenceFeed {
  readonly id = "kraken-usd";
  private readonly observers = new Map<string, Map<number, Observer<PriceObservation>>>();
  private readonly latest = new Map<string, PriceObservation>();
  private readonly order = new OrderedSource(5000);
  private readonly socket: ReconnectingSocket;
  private sequence = 0;
  private started = false;
  private connected = false;
  private marketOnline = false;
  private reason = "No active subscriptions";
  constructor(private readonly allowed: readonly string[], private readonly log: (fault: Fault) => void,
    private readonly now = Date.now, endpoint = "wss://ws.kraken.com/v2") {
    if (allowed.length === 0 || new Set(allowed).size !== allowed.length || allowed.some((s) => !/^[A-Z0-9]+\/USD$/.test(s))) throw new Error("Invalid Kraken coverage");
    this.socket = new ReconnectingSocket({ url: endpoint, source: this.id, reconnectMs: 1000, maximumReconnectMs: 30000, idleMs: 15000,
      onOpen: () => { this.connected = true; this.marketOnline = false; this.request("subscribe", [...this.observers.keys()]); },
      onFrame: (frame) => this.frame(frame),
      onGap: (reason) => { this.connected = false; this.marketOnline = false; this.invalidate(reason); } });
  }
  async subscribe(instrument: string, observer: Observer<PriceObservation>): Promise<Outcome<Subscription>> {
    if (!this.allowed.includes(instrument)) {
      const error: Fault = { code: "UNSUPPORTED", message: "Unsupported Kraken instrument", retryable: false, context: { provider: this.id, instrument } };
      this.log(error); return { ok: false, error };
    }
    let listeners = this.observers.get(instrument);
    const first = listeners === undefined;
    if (listeners === undefined) { listeners = new Map(); this.observers.set(instrument, listeners); }
    const id = ++this.sequence; listeners.set(id, observer);
    if (!this.started) { this.started = true; this.reason = "Connecting"; this.socket.start(); }
    else if (first && this.connected) this.request("subscribe", [instrument]);
    const cached = this.latest.get(instrument);
    if (cached !== undefined && this.now() - cached.sourceAtMs < 5000) this.deliver(observer, { ok: true, value: cached }, instrument);
    let stopped = false;
    return { ok: true, value: { stop: async () => {
      if (stopped) return; stopped = true;
      const active = this.observers.get(instrument);
      if (active === undefined) throw new Error("Subscription registry lost active entry");
      active.delete(id);
      if (active.size === 0) {
        this.observers.delete(instrument); this.latest.delete(instrument);
        if (this.connected) this.request("unsubscribe", [instrument]);
      }
      if (this.observers.size === 0) {
        this.started = false; this.connected = false; this.reason = "No active subscriptions"; await this.socket.stop();
      }
    } } };
  }
  health(): Health {
    const now = this.now();
    const fresh = this.connected && this.marketOnline && this.observers.size > 0 && [...this.observers.keys()].every((key) => {
      const value = this.latest.get(key); return value !== undefined && value.sourceAtMs <= now && now - value.sourceAtMs < 5000;
    });
    return { source: this.id, healthy: fresh, checkedAt: now, reason: fresh ? "Fresh USD venue quotes" : this.reason === "Fresh quote" ? "Quote stale" : this.reason };
  }
  private request(method: "subscribe" | "unsubscribe", symbol: string[]): void {
    if (symbol.length === 0) return;
    this.socket.send(JSON.stringify({ method, params: { channel: "ticker", symbol, event_trigger: "bbo", ...(method === "subscribe" ? { snapshot: true } : {}) } }));
  }
  private frame(frame: string): void {
    const message = JSON.parse(frame) as Record<string, unknown>;
    if (message.channel === "heartbeat") return;
    if (message.channel === "status") {
      this.marketOnline = Array.isArray(message.data) && message.data.length > 0 && message.data.every((row) => row.system === "online");
      if (!this.marketOnline) this.invalidate("Kraken system not online");
      return;
    }
    if (message.method === "subscribe" || message.method === "unsubscribe") {
      if (message.success !== true) this.invalidate("Kraken subscription rejected");
      return;
    }
    if (message.channel !== "ticker" || !["snapshot", "update"].includes(String(message.type)) || !Array.isArray(message.data)) throw new Error("Unexpected Kraken frame");
    if (!this.marketOnline) { this.invalidate("Ticker received while market status is unavailable"); return; }
    for (const row of message.data) {
      const instrument = typeof row?.symbol === "string" ? row.symbol : "unknown";
      if (!this.observers.has(instrument)) { this.invalidate("Unrequested ticker received"); continue; }
      try {
        const price = decodeTicker(row, this.order, this.now());
        this.latest.set(instrument, price); this.reason = "Fresh quote";
        for (const observer of this.observers.get(instrument)!.values()) this.deliver(observer, { ok: true, value: price }, instrument);
      } catch (error) {
        const sourceTime = typeof row.timestamp === "string" && row.timestamp.length <= 35 ? row.timestamp : "invalid";
        this.invalidate(error instanceof Error ? error.message : "Invalid ticker", instrument, sourceTime);
      }
    }
  }
  private invalidate(reason: string, instrument?: string, sourceTime?: string): void {
    this.reason = reason;
    const keys = instrument === undefined ? [...this.observers.keys()] : [instrument];
    const context: Record<string, string> = { provider: this.id, instruments: keys.join(","), receivedAtMs: String(this.now()) };
    if (sourceTime !== undefined) context.sourceTime = sourceTime;
    const error: Fault = { code: "UNAVAILABLE", message: reason, retryable: true, context };
    this.log(error);
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
