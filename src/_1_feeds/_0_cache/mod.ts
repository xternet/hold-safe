import { chainKey, copyValue, policyDigest, type AuthorizationState, type ChainReader, type Fault, type HoldingObservation,
  type MonitorPort, type Outcome, type Policy, type PriceObservation, type ReferenceFeed, type RiskInput, type Subscription, type VenuePort } from "../../_kernel/mod";

export type FeedOptions = { feeds: ReadonlyMap<string, ReferenceFeed>; chain: ChainReader; venue: VenuePort;
  session: (nowMs: number) => RiskInput["session"]; now: () => number; log: (fault: Fault) => void };
type Entry = { policy: Policy; epoch: number; references: number; subscriptions: Subscription[];
  reference?: Outcome<PriceObservation>; output?: Outcome<PriceObservation>; holding?: Outcome<HoldingObservation> };
export class FeedMonitor implements MonitorPort {
  private readonly entries = new Map<string, Promise<Entry>>();
  constructor(private readonly options: FeedOptions) {}
  private missing<T>(source: string): Outcome<T> {
    return { ok: false, error: { code: "UNAVAILABLE", message: "Observation unavailable", retryable: true, context: { source } } };
  }
  async watch(document: Policy): Promise<Outcome<Subscription>> {
    const policy = copyValue(document), digest = await policyDigest(policy);
    let pending = this.entries.get(digest);
    try {
      if (pending === undefined) {
        if (this.entries.size >= 128) throw new Error("Feed monitor capacity exceeded");
        pending = this.connect(policy); this.entries.set(digest, pending);
      }
      const entry = await pending; entry.references++;
      let stopped = false;
      return { ok: true, value: { stop: async () => {
        if (stopped) return; stopped = true; entry.references--;
        if (entry.references === 0) { this.entries.delete(digest); await this.close(entry.subscriptions); }
      } } };
    } catch {
      if (pending !== undefined && this.entries.get(digest) === pending) this.entries.delete(digest);
      const fault: Fault = { code: "UNAVAILABLE", message: "Policy subscriptions unavailable", retryable: true, context: { policyDigest: digest } };
      this.options.log(fault); return { ok: false, error: fault };
    }
  }
  private async connect(policy: Policy): Promise<Entry> {
    if (chainKey(policy.chain) !== chainKey(this.options.chain.chain) || policy.coverage.venue !== this.options.venue.id) throw new Error("Unsupported monitor domain/venue");
    const reference = this.options.feeds.get(policy.coverage.inputReference.provider), output = this.options.feeds.get(policy.coverage.outputReference.provider);
    if (reference === undefined || output === undefined) throw new Error("Missing reference-feed adapter");
    const entry: Entry = { policy, epoch: 0, references: 0, subscriptions: [] };
    const observe = <T>(assign: (value: Outcome<T>) => void) => (value: Outcome<T>) => {
      if (!value.ok) { entry.epoch++; this.options.log(value.error); }
      assign(copyValue(value));
    };
    const results = await Promise.allSettled([
      reference.subscribe(policy.coverage.inputReference.instrument, observe(value => { entry.reference = value; })),
      output.subscribe(policy.coverage.outputReference.instrument, observe(value => { entry.output = value; })),
      this.options.chain.subscribeHolding(policy, observe(value => { entry.holding = value; })),
    ]);
    for (const result of results) if (result.status === "fulfilled" && result.value.ok) entry.subscriptions.push(result.value.value);
    if (entry.subscriptions.length !== 3) {
      for (const result of results) if (result.status === "fulfilled" && !result.value.ok) this.options.log(result.value.error);
      await this.close(entry.subscriptions); throw new Error("Subscription setup failed");
    }
    return entry;
  }
  private async close(subscriptions: Subscription[]): Promise<void> {
    const results = await Promise.allSettled(subscriptions.map(subscription => subscription.stop()));
    if (results.some(result => result.status === "rejected")) {
      this.options.log({ code: "UNAVAILABLE", message: "Subscription cleanup failed", retryable: true, context: { component: "feed-monitor" } });
      throw new Error("Subscription cleanup failed");
    }
  }
  async refresh(policy: Policy, previous: RiskInput): Promise<RiskInput> {
    const prior = copyValue(previous), digest = await policyDigest(policy), pending = this.entries.get(digest);
    if (pending === undefined) throw new Error("Policy is not watched");
    return this.current(await pending, prior.authorization, prior.quote);
  }
  private current(entry: Entry, authorization: Outcome<AuthorizationState>, quote: RiskInput["quote"]): RiskInput {
    const nowMs = this.options.now();
    return copyValue({ nowMs, gapEpoch: entry.epoch, session: this.options.session(nowMs), authorization, quote,
      reference: entry.reference === undefined ? this.missing("reference") : entry.reference,
      output: entry.output === undefined ? this.missing("output") : entry.output,
      holding: entry.holding === undefined ? this.missing("holding") : entry.holding });
  }
  async snapshot(policy: Policy, inputAuthorization: Outcome<AuthorizationState>): Promise<RiskInput> {
    const authorization = copyValue(inputAuthorization), digest = await policyDigest(policy), pending = this.entries.get(digest);
    if (pending === undefined) throw new Error("Policy is not watched");
    const entry = await pending, epoch = entry.epoch;
    let quote: RiskInput["quote"];
    try { quote = await this.options.venue.quote(copyValue(entry.policy), digest); }
    catch {
      quote = { ok: false, error: { code: "UNAVAILABLE", message: "Quote request failed; details redacted", retryable: true, context: { policyDigest: digest } } };
    }
    if (!quote.ok) this.options.log(quote.error);
    if (entry.epoch !== epoch) quote = this.missing("feed-gap-during-quote");
    return this.current(entry, authorization, quote);
  }
}
