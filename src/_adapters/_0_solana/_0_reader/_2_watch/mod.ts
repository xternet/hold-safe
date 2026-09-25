import { PublicKey } from "@solana/web3.js";
import type { Fault, Health, Subscription } from "../../../../_kernel/mod";
import { ReconnectingSocket } from "../../../../_shared/_3_socket/mod";

type Listener = { change(slot: number): void; gap(fault: Fault): void };
type Watch = { listeners: Set<Listener>; subscription?: number };
type Request = { method: string; key: string; watch?: Watch; subscription?: number };
export class AccountWatch {
  private readonly accounts = new Map<string, Watch>();
  private readonly requests = new Map<number, Request>();
  private readonly subscriptions = new Map<number, string>();
  private readonly socket: ReconnectingSocket;
  private sequence = 0;
  private started = false;
  private connected = false;
  private slotAt: number | undefined;
  private reason = "No native subscriptions";
  constructor(endpoint: string, private readonly log: (fault: Fault) => void, private readonly now = Date.now) {
    const url = new URL(endpoint);
    if (url.protocol !== "wss:" && !(url.protocol === "ws:" && url.hostname === "127.0.0.1")) throw new Error("Native subscription requires WSS");
    this.socket = new ReconnectingSocket({ url: endpoint, source: "solana-account-stream", reconnectMs: 1000, maximumReconnectMs: 30000, idleMs: 5000,
      onOpen: () => {
        this.connected = true; this.request("slotSubscribe", "", []);
        for (const key of this.accounts.keys()) this.request("accountSubscribe", key, [key, { commitment: "confirmed", encoding: "base64" }]);
      }, onFrame: frame => this.frame(frame), onGap: reason => this.gap(reason) });
  }
  subscribe(keys: readonly string[], change: Listener["change"], gap: Listener["gap"]): Subscription {
    if (keys.length === 0 || new Set(keys).size !== keys.length || keys.some(key => new PublicKey(key).toBase58() !== key)) throw new Error("Invalid watched accounts");
    const listener: Listener = { change, gap };
    for (const key of keys) {
      let watch = this.accounts.get(key);
      if (watch === undefined) {
        watch = { listeners: new Set() }; this.accounts.set(key, watch);
        if (this.connected) this.request("accountSubscribe", key, [key, { commitment: "confirmed", encoding: "base64" }]);
      }
      watch.listeners.add(listener);
    }
    if (!this.started) { this.started = true; this.reason = "Connecting account stream"; this.socket.start(); }
    let stopped = false;
    return { stop: async () => {
      if (stopped) return; stopped = true;
      for (const key of keys) {
        const watch = this.accounts.get(key); if (watch === undefined) throw new Error("Lost native subscription");
        watch.listeners.delete(listener);
        if (watch.listeners.size === 0) {
          this.accounts.delete(key);
          if (this.connected && watch.subscription !== undefined) this.request("accountUnsubscribe", key, [watch.subscription]);
        }
      }
      if (this.accounts.size === 0) {
        this.started = false; this.connected = false; this.slotAt = undefined; this.reason = "No native subscriptions";
        await this.socket.stop(); this.requests.clear(); this.subscriptions.clear();
      }
    } };
  }
  health(): Health {
    const now = this.now(), healthy = this.connected && this.accounts.size > 0 && this.slotAt !== undefined && this.slotAt <= now && now - this.slotAt < 5000 &&
      [...this.accounts.values()].every(watch => watch.subscription !== undefined);
    return { source: "solana-account-stream", healthy, checkedAt: now, reason: healthy ? "Live account/slot subscriptions" : this.reason };
  }
  private request(method: string, key: string, params: unknown[]): void {
    const id = ++this.sequence;
    const request: Request = { method, key };
    if (method === "accountSubscribe") request.watch = this.accounts.get(key);
    if (method.endsWith("Unsubscribe")) request.subscription = Number(params[0]);
    this.requests.set(id, request);
    this.socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  }
  private frame(frame: string): void {
    const message = JSON.parse(frame);
    if (message === null || message.jsonrpc !== "2.0") throw new Error("Invalid native notification");
    if (message.id !== undefined) {
      const request = this.requests.get(message.id); if (request === undefined) throw new Error("Unexpected native acknowledgement");
      this.requests.delete(message.id);
      if (message.error !== undefined) {
        const code = Number.isSafeInteger(message.error?.code) ? String(message.error.code) : "invalid";
        this.log({ code: "UNAVAILABLE", message: "Native subscription RPC error", retryable: true, context: { code, method: request.method } });
        throw new Error("Native subscription rejected");
      }
      if (request.method.endsWith("Unsubscribe")) {
        if (message.result !== true) throw new Error("Native unsubscribe rejected");
        if (request.subscription !== undefined) this.subscriptions.delete(request.subscription);
        return;
      }
      if (!Number.isSafeInteger(message.result) || message.result < 0) throw new Error("Invalid native subscription id");
      this.subscriptions.set(message.result, request.key);
      if (request.method === "accountSubscribe") {
        const watch = this.accounts.get(request.key);
        if (watch === undefined || watch !== request.watch) this.request("accountUnsubscribe", request.key, [message.result]);
        else watch.subscription = message.result;
      }
      return;
    }
    const params = message.params, key = this.subscriptions.get(params?.subscription);
    if (key === undefined) throw new Error("Unknown native subscription notification");
    const slot = key === "" ? params.result?.slot : params.result?.context?.slot;
    if (!Number.isSafeInteger(slot) || slot <= 0 || message.method !== (key === "" ? "slotNotification" : "accountNotification")) throw new Error("Invalid native notification slot");
    if (key === "") { this.slotAt = this.now(); return; }
    const watch = this.accounts.get(key);
    if (watch === undefined) { this.log({ code: "UNAVAILABLE", message: "Late account notification after unsubscribe", retryable: true, context: { key } }); return; }
    for (const listener of watch.listeners) this.deliver(() => listener.change(slot), key);
  }
  private gap(reason: string): void {
    this.connected = false; this.slotAt = undefined; this.reason = reason; this.requests.clear(); this.subscriptions.clear();
    const fault: Fault = { code: "UNAVAILABLE", message: reason, retryable: true, context: { source: "solana-account-stream", receivedAtMs: String(this.now()) } };
    this.log(fault);
    const listeners = new Set<Listener>();
    for (const watch of this.accounts.values()) { delete watch.subscription; for (const listener of watch.listeners) listeners.add(listener); }
    for (const listener of listeners) this.deliver(() => listener.gap(fault), "stream");
  }
  private deliver(callback: () => void, key: string): void {
    try { callback(); }
    catch { this.log({ code: "FAILED", message: "Native watch observer failed", retryable: false, context: { key } }); }
  }
}
