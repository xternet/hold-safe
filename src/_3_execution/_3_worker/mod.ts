import { copyValue, type PolicyRecord } from "../../_kernel/mod";
import { BoundedScheduler } from "../../_shared/_4_schedule/mod";
import { evaluate } from "../_2_evaluate/mod";
import { WorkerError, type Session, type WorkerOptions } from "../_shared/mod";

export class ExecutionWorker {
  private readonly sessions = new Map<string, Session>();
  private readonly scheduler: BoundedScheduler;
  private readonly shutdown = new AbortController();
  private flight: Promise<void> | null = null;
  private stopped = false;
  private running = false;
  private cursor: string | null = null;
  private failures = 0;
  private healthy = false;
  private checkedAt = 0;
  constructor(private readonly options: WorkerOptions) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.id)) throw new Error("Invalid worker identity");
    this.scheduler = new BoundedScheduler(4, 128, 45000, fault => { this.failures++; this.options.log(fault); });
  }
  health() { return { healthy: this.healthy && !this.stopped, checkedAt: this.checkedAt, active: this.sessions.size, queue: this.scheduler.stats() }; }
  tick(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("Worker stopped"));
    if (this.flight !== null) return this.flight;
    this.flight = this.scan().finally(() => { this.flight = null; }); return this.flight;
  }
  private async scan(): Promise<void> {
    const before = this.failures, pending: Promise<void>[] = [], seen = new Set<string>();
    try {
      const page = await this.options.journal.scanActive(this.cursor, 128);
      this.cursor = page.length === 128 ? page[page.length - 1]!.digest : null;
      for (const record of page) {
        seen.add(record.digest);
        pending.push(new Promise<void>(resolve => {
          const status = this.scheduler.submit(record.digest, async deadline => {
            try { await this.process(record, AbortSignal.any([deadline, this.shutdown.signal])); }
            catch (error) { this.fault(record.digest, error); await this.dispose(record.digest); }
            finally { resolve(); }
          });
          if (status === "full" || status === "stopped") resolve();
        }));
      }
      await Promise.all(pending);
      for (const digest of this.sessions.keys()) if (!seen.has(digest)) {
        const current = await this.options.journal.readPolicy(digest);
        if (current === null || ["DRAFT", "CONFIRMED", "REVOKED", "EXPIRED"].includes(current.state)) await this.dispose(digest);
      }
    } catch (error) { this.fault("scan", error); await Promise.all(pending); }
    this.checkedAt = this.options.now(); this.healthy = this.failures === before;
  }
  private async process(record: PolicyRecord, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    let session = this.sessions.get(record.digest);
    if (session === undefined) {
      if (this.sessions.size >= 128) throw new WorkerError("Active worker policy capacity exceeded");
      const claim = await this.options.journal.claim(record.digest, this.options.id, 60000);
      if (claim === null) return;
      session = { record: copyValue(record), claim, rule: null, watch: null, state: null, lastDecision: null };
      this.sessions.set(record.digest, session);
    } else session.claim = await this.options.journal.renew(session.claim, 60000);
    const current = await this.options.journal.readPolicy(record.digest);
    if (current === null) throw new WorkerError("Claimed policy disappeared");
    session.record = current;
    if (["DRAFT", "CONFIRMED", "REVOKED", "EXPIRED"].includes(current.state) || await evaluate(this.options, session, signal)) await this.dispose(record.digest);
  }
  private fault(digest: string, error: unknown) {
    this.failures++;
    this.options.log({ code: "UNAVAILABLE", message: error instanceof WorkerError ? error.message : "Worker operation failed; details redacted", retryable: true,
      context: { worker: this.options.id, policyDigest: digest, checkedAtMs: String(this.options.now()) } });
  }
  private async dispose(digest: string): Promise<void> {
    const session = this.sessions.get(digest); if (session === undefined) return;
    this.sessions.delete(digest); session.state = null;
    const work = [this.options.journal.release(session.claim)];
    if (session.watch !== null) work.push(session.watch.stop());
    const results = await Promise.allSettled(work);
    for (const result of results) if (result.status === "rejected") this.fault(digest, result.reason);
  }
  async stop(): Promise<void> {
    this.stopped = true; this.shutdown.abort();
    if (this.flight !== null) await this.flight;
    await this.scheduler.stop();
    for (const digest of this.sessions.keys()) await this.dispose(digest);
  }
  async run(signal: AbortSignal): Promise<void> {
    if (this.running || this.stopped) throw new Error("Worker already running or stopped"); this.running = true;
    const abort = () => this.shutdown.abort(); signal.addEventListener("abort", abort, { once: true });
    try {
      while (!signal.aborted && !this.stopped) {
        await this.tick();
        if (signal.aborted || this.stopped) break;
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 1000); signal.addEventListener("abort", done, { once: true });
        });
      }
    } finally { signal.removeEventListener("abort", abort); await this.stop(); }
  }
}
