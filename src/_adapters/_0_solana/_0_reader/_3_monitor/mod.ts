import { copyValue } from "../../../../_kernel/mod";
import { createHash } from "node:crypto";
import { canonicalPolicy, validatePolicy, type Catalog, type Fault, type HoldingObservation, type Observer, type Outcome, type Policy, type Subscription } from "../../../../_kernel/mod";
import { BoundedScheduler } from "../../../../_shared/_4_schedule/mod";
import { nativePolicy } from "../../_shared/mod";
import type { HoldingReads } from "../_1_reads/mod";
import type { AccountWatch } from "../_2_watch/mod";

type Group = { policy: Policy; observers: Set<Observer<HoldingObservation>>; watch: Subscription; minimumSlot: number; generation: number };
export class HoldingMonitor {
  private readonly groups = new Map<string, Group>();
  private queue: BoundedScheduler | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<void> | undefined;
  constructor(private readonly reads: HoldingReads, private readonly watch: AccountWatch, private readonly catalog: Catalog,
    private readonly log: (fault: Fault) => void, private readonly now = Date.now) {}
  async subscribe(policy: Policy, observer: Observer<HoldingObservation>): Promise<Outcome<Subscription>> {
    await this.closing;
    try { validatePolicy(policy, this.catalog, Math.floor(this.now() / 1000)); nativePolicy(policy); }
    catch { return { ok: false, error: this.fault("Invalid holding subscription policy", policy.source) }; }
    const network = await this.reads.verifyNetwork(); if (!network.ok) return network;
    await this.closing;
    const key = createHash("sha256").update(canonicalPolicy(policy)).digest("hex");
    let group = this.groups.get(key);
    if (group === undefined) {
      if (this.groups.size >= 128 || [...this.groups.values()].some(g => g.policy.source === policy.source)) {
        return { ok: false, error: this.fault("Holding subscription capacity or source conflict", policy.source) };
      }
      if (this.queue === undefined) {
        this.queue = new BoundedScheduler(4, 128, 5000, this.log);
        this.timer = setInterval(() => { for (const [id, active] of this.groups) this.schedule(id, active); }, 1000);
      }
      const watched = this.watch.subscribe([policy.input.address, policy.source], slot => {
        const active = this.groups.get(key);
        if (active !== undefined) { active.minimumSlot = Math.max(active.minimumSlot, slot); this.schedule(key, active); }
      }, fault => {
        const active = this.groups.get(key);
        if (active !== undefined) { active.generation++; this.deliver(active, { ok: false, error: fault }); }
      });
      group = { policy: copyValue(policy), observers: new Set(), watch: watched, minimumSlot: 0, generation: 0 };
      this.groups.set(key, group);
    }
    const listener: Observer<HoldingObservation> = result => observer(result);
    group.observers.add(listener); this.schedule(key, group);
    let stopped = false;
    return { ok: true, value: { stop: async () => {
      if (stopped) return; stopped = true;
      const active = this.groups.get(key); if (active === undefined) throw new Error("Lost holding subscription");
      active.observers.delete(listener);
      if (active.observers.size === 0) {
        this.groups.delete(key);
        if (this.groups.size === 0 && this.queue !== undefined) {
          if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined;
          const queue = this.queue; this.queue = undefined;
          this.closing = Promise.all([active.watch.stop(), queue.stop()]).then(() => {});
          await this.closing; this.closing = undefined;
        } else await active.watch.stop();
      }
    } } };
  }
  private schedule(key: string, group: Group): void {
    if (this.queue === undefined) throw new Error("Missing holding work queue");
    const status = this.queue.submit(key, async signal => {
      if (this.groups.get(key) !== group) return;
      const generation = group.generation;
      const result = await this.reads.readHolding(group.policy, group.minimumSlot);
      if (this.groups.get(key) !== group) return;
      if (signal.aborted || generation !== group.generation || (result.ok && JSON.parse(result.value.context.serialized).slot < group.minimumSlot)) {
        this.deliver(group, { ok: false, error: this.fault("Holding read superseded or timed out", group.policy.source) }); return;
      }
      this.deliver(group, result);
    });
    if (status === "full" || status === "stopped") this.deliver(group, { ok: false, error: this.fault("Holding refresh not scheduled", group.policy.source) });
  }
  private deliver(group: Group, result: Outcome<HoldingObservation>): void {
    for (const observer of group.observers) {
      try { observer(copyValue(result)); }
      catch { this.log({ code: "FAILED", message: "Holding observer failed", retryable: false, context: { source: group.policy.source } }); }
    }
  }
  private fault(message: string, account: string): Fault {
    const fault: Fault = { code: "UNAVAILABLE", message, retryable: true, context: { account, receivedAtMs: String(this.now()) } };
    this.log(fault); return fault;
  }
}
