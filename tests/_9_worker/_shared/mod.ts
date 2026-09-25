import { PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { Clock } from "litesvm";
import { type ChainReader, type Observer, type PriceObservation, type HoldingObservation, type ReferenceFeed, ratio } from "../../../src/_kernel/mod";
import { createFeedMonitor } from "../../../src/_1_feeds/mod";
import { createRiskRule } from "../../../src/_2_risk/mod";
import { createWorker } from "../../../src/_3_execution/mod";
import { createExecution } from "../../../src/_adapters/_0_solana/_2_execution/mod";
import { AuthorizationReads } from "../../../src/_adapters/_0_solana/_1_authorize/_0_read/mod";
import { HoldingReads } from "../../../src/_adapters/_0_solana/_0_reader/_1_reads/mod";
import { createJournal } from "../../../src/_shared/_0_store/mod";
import { armed, journalFixture } from "../../_5_storage/_shared/mod";
import { deliveryFixture } from "../../_8_authorization/_3_delivery/_shared/mod";

export async function workerFixture(armOnchain = true) {
  const f = await deliveryFixture(armOnchain), db = await journalFixture(), log = f.options.log;
  const authorization = new AuthorizationReads(f.connection, f.catalog, f.manifest, log, f.now);
  const holdings = new HoldingReads(f.connection, f.catalog, log, f.now);
  const journal = createJournal(db.open().sql, f.catalog, log);
  if (armOnchain) {
    const initial = await armed(journal, "fixture-registration", f.policy); await journal.release(initial.claim);
  } else {
    await journal.putPolicy(f.policy); const claim = await journal.claim(f.digest, "fixture-registration", 60000);
    if (claim === null) throw new Error("Fixture registration claim missing");
    await journal.transition(claim, "DRAFT", "ARMING", { adapter: "fixture", version: 1, serialized: "{}" }); await journal.release(claim);
  }
  const prices = new Map<string, Set<Observer<PriceObservation>>>(), holdingListeners = new Set<Observer<HoldingObservation>>();
  function observation(kind: "input" | "output"): PriceObservation {
    const mapping = kind === "input" ? f.policy.coverage.inputReference : f.policy.coverage.outputReference;
    // Deliberate synthetic market inputs drive the real risk algorithm. They
    // are not claimed to be current SIP/USDC prices or a detected incident.
    const price = kind === "input" ? ratio(1000n, 1n) : ratio(1n, 1n);
    return { ...mapping, id: `${mapping.provider}-${f.now()}`, sourceAtMs: f.now(), receivedAtMs: f.now(),
      bidUsd: price, askUsd: price, bidSize: ratio(10000n, 1n), askSize: ratio(10000n, 1n),
      sizeUnit: kind === "input" ? "round_lots" : "base_asset", session: kind === "input" ? "regular" : "continuous" };
  }
  const feeds = new Map<string, ReferenceFeed>();
  for (const kind of ["input", "output"] as const) {
    const id = observation(kind).provider, listeners = new Set<Observer<PriceObservation>>(); prices.set(id, listeners);
    feeds.set(id, { id, health: () => ({ source: id, healthy: true, checkedAt: f.now(), reason: "controlled fixture" }),
      subscribe: async (_instrument, observer) => { listeners.add(observer); observer({ ok: true, value: observation(kind) });
        return { ok: true, value: { stop: async () => { listeners.delete(observer); } } }; } });
  }
  const chain: ChainReader = { chain: f.policy.chain, verifyNetwork: () => holdings.verifyNetwork(), health: () => holdings.health(),
    readHolding: policy => holdings.readHolding(policy), subscribeHolding: async (policy, observer) => {
      holdingListeners.add(observer); observer(await holdings.readHolding(policy));
      return { ok: true, value: { stop: async () => { holdingListeners.delete(observer); } } };
    } };
  const workers: ReturnType<typeof createWorker>[] = [];
  function worker(id: string, afterSimulation?: () => void, afterPrepared?: () => void) {
    const native = createExecution(f.options, { keeper: f.a.keeper, route: f.route, authorization, holdings });
    const execution = afterSimulation === undefined ? native : { ...native,
      simulate: async (transaction: Parameters<typeof native.simulate>[0]) => { const result = await native.simulate(transaction); afterSimulation(); return result; } };
    const monitor = createFeedMonitor({ feeds, chain, venue: f.route.venue, session: () => "regular", now: f.now, log });
    const journalPort = afterPrepared === undefined ? journal : { ...journal,
      prepare: async (...args: Parameters<typeof journal.prepare>) => { const saved = await journal.prepare(...args); afterPrepared(); return saved; } };
    const instance = createWorker({ id, journal: journalPort, authorization, execution, monitor, risk: policy => createRiskRule(policy, f.catalog, f.now()), now: f.now, log });
    workers.push(instance); return instance;
  }
  async function advance(seconds = 1) {
    const c = f.svm.getClock();
    f.svm.setClock(new Clock(c.slot + BigInt(seconds * 2), c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + BigInt(seconds)));
    // Refresh the quote batch from actual local SVM accounts, including its Clock.
    for (const key of f.batch.accounts.keys()) {
      const account = f.get(key); f.batch.accounts.set(key, { data: Buffer.from(account.data), owner: new PublicKey(account.programAddress),
        executable: account.executable, lamports: Number(account.lamports) });
    }
    f.batch.slot = Number(f.svm.getClock().slot); f.batch.observedAtMs = f.now();
    if (!f.batch.accounts.has(SYSVAR_CLOCK_PUBKEY.toBase58())) throw new Error("Native fixture clock missing");
    for (const kind of ["input", "output"] as const) for (const observer of prices.get(observation(kind).provider)!) observer({ ok: true, value: observation(kind) });
    const holding = await holdings.readHolding(f.policy); for (const observer of holdingListeners) observer(holding);
  }
  return { ...f, db, journal, worker, advance, prices, async close() {
    for (const worker of workers) await worker.stop(); await db.close(); await f.stop();
  } };
}
