import type { Fault } from "../../_kernel/mod";

type Job = (signal: AbortSignal) => Promise<void>;
export class BoundedScheduler {
  private readonly pending = new Map<string, Job>();
  private readonly active = new Set<string>();
  private stopped = false;
  private coalesced = 0;
  private rejected = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly concurrency: number, private readonly capacity: number,
    private readonly deadlineMs: number, private readonly log: (fault: Fault) => void) {
    if (![concurrency, capacity, deadlineMs].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error("Invalid scheduler limits");
  }
  submit(key: string, job: Job): "queued" | "coalesced" | "full" | "stopped" {
    if (!key) throw new Error("Missing work identity");
    if (this.stopped) { this.fault(key, "Scheduler stopped"); return "stopped"; }
    if (this.pending.has(key)) { this.pending.set(key, job); this.coalesced++; return "coalesced"; }
    if (this.pending.size >= this.capacity) { this.rejected++; this.fault(key, "Scheduler capacity exceeded"); return "full"; }
    this.pending.set(key, job); this.drain(); return "queued";
  }
  stats() { return { active: this.active.size, pending: this.pending.size, coalesced: this.coalesced, rejected: this.rejected }; }
  private drain(): void {
    for (const [key, job] of this.pending) {
      if (this.active.size >= this.concurrency) break;
      if (this.active.has(key)) continue;
      this.pending.delete(key); this.active.add(key);
      const controller = new AbortController();
      const timeout = setTimeout(() => { this.fault(key, "Work deadline exceeded"); controller.abort(); }, this.deadlineMs);
      // A timed-out task keeps its slot until it settles, bounding actual work.
      void Promise.resolve().then(() => job(controller.signal)).catch(() => this.fault(key, "Scheduled work failed; details redacted"))
        .finally(() => {
          clearTimeout(timeout); this.active.delete(key); this.drain();
          if (this.active.size === 0 && this.pending.size === 0) for (const resolve of this.waiters.splice(0)) resolve();
        });
    }
  }
  private fault(key: string, message: string): void {
    this.log({ code: "UNAVAILABLE", message, retryable: !this.stopped, context: { source: "scheduler", key } });
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.active.size === 0 && this.pending.size === 0) return;
    await new Promise<void>(resolve => { this.waiters.push(resolve); });
  }
}
