type Options = {
  url: string; source: string; reconnectMs: number; maximumReconnectMs: number; idleMs: number;
  onOpen(): void; onFrame(frame: string): void; onGap(reason: string): void;
};

export class ReconnectingSocket {
  private socket: WebSocket | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private generation = 0;
  private failures = 0;
  private lastFrame = 0;
  constructor(private readonly options: Options) {
    if (![options.reconnectMs, options.maximumReconnectMs, options.idleMs].every((v) => Number.isSafeInteger(v) && v > 0) ||
        options.maximumReconnectMs < options.reconnectMs) throw new Error("Invalid socket timing bounds");
  }
  start(): void {
    if (this.running) throw new Error("Socket already started");
    this.running = true; this.connect();
  }
  send(frame: string): void {
    if (!this.running || this.socket === undefined || this.socket.readyState !== WebSocket.OPEN) throw new Error("Socket unavailable");
    this.socket.send(frame);
  }
  private connect(): void {
    if (!this.running) return;
    const generation = ++this.generation;
    this.lastFrame = Date.now();
    let socket: WebSocket;
    try { socket = new WebSocket(this.options.url); }
    catch { this.failed(generation, "connection initialization failed"); return; }
    this.socket = socket;
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastFrame >= this.options.idleMs) this.failed(generation, "connection idle timeout");
    }, Math.max(10, Math.min(1000, Math.floor(this.options.idleMs / 2))));
    socket.onopen = () => {
      if (generation !== this.generation) return;
      try { this.options.onOpen(); }
      catch { this.failed(generation, "open handler failed"); }
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      if (typeof event.data !== "string" || new TextEncoder().encode(event.data).length > 65_536) {
        this.failed(generation, "oversized or non-text frame"); return;
      }
      try {
        this.options.onFrame(event.data);
        this.lastFrame = Date.now(); this.failures = 0;
      } catch { this.failed(generation, "invalid frame"); }
    };
    socket.onerror = () => this.failed(generation, "transport error");
    socket.onclose = (event) => this.failed(generation, `connection closed (${event.code})`);
  }
  private failed(generation: number, reason: string): void {
    if (!this.running || generation !== this.generation) return;
    ++this.generation;
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.watchdog = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket !== undefined && socket.readyState < WebSocket.CLOSING) socket.close();
    this.options.onGap(`${this.options.source}: ${reason}`);
    if (!this.running) return;
    const delay = Math.min(this.options.maximumReconnectMs, this.options.reconnectMs * 2 ** Math.min(this.failures++, 10));
    this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, delay);
  }
  async stop(): Promise<void> {
    this.running = false; ++this.generation;
    if (this.retry !== undefined) clearTimeout(this.retry);
    if (this.watchdog !== undefined) clearInterval(this.watchdog);
    this.retry = undefined; this.watchdog = undefined;
    const socket = this.socket; this.socket = undefined;
    if (socket === undefined || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { this.options.onGap(`${this.options.source}: close acknowledgement timed out`); resolve(); }, 2000);
      socket.addEventListener("close", () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.close();
    });
  }
}
