import { createAdapters, createDemoReference } from "./_adapters/mod";
import { setup, withResources, foreground } from "./_0_setup/mod";
import { createFeedMonitor } from "./_1_feeds/mod";
import { createRiskRule } from "./_2_risk/mod";
import { createWorker } from "./_3_execution/mod";
import { createPolicyWorkflow } from "./_4_authorization/mod";
import { startApi } from "./_5_app/_4_api/mod";
import { createJournal } from "./_shared/_0_store/mod";
import type { Catalog, Fault, JournalPort } from "./_kernel/mod";
import { runDemo } from "./_adapters/_0_solana/_7_demo/mod";

export function composeWorker(adapters: Awaited<ReturnType<typeof createAdapters>>, journal: JournalPort,
  catalog: Catalog, log: (fault: Fault) => void, now = Date.now) {
  const monitor = createFeedMonitor({ ...adapters, log, now });
  return createWorker({ id: crypto.randomUUID(), journal, authorization: adapters.authorization,
    execution: adapters.execution, monitor, risk: policy => createRiskRule(policy, catalog, now()), log, now });
}
export async function runService(env: Readonly<Record<string, string | undefined>>, signal: AbortSignal, log: (fault: Fault) => void) {
  await withResources(log, async defer => {
    signal.throwIfAborted();
    const { config, catalog, storage } = await setup(env, log);
    defer("database", () => storage.close());
    signal.throwIfAborted();
    const journal = createJournal(storage.sql, catalog, log);
    const adapters = await createAdapters({ ...config, catalog, log, now: Date.now, policy: async digest => {
      const record = await journal.readPolicy(digest);
      if (record === null) throw new Error("Stored policy unavailable");
      return record.document;
    } });
    defer("calendar", () => adapters.stop());
    signal.throwIfAborted();
    await adapters.start();
    const worker = composeWorker(adapters, journal, catalog, log);
    defer("worker", () => worker.stop());
    const workflow = createPolicyWorkflow({ ...adapters, chain: adapters.chain.chain, catalog, journal, log, now: Date.now });
    const api = startApi({ origin: config.origin, ...adapters, catalog, workflow, log, now: Date.now,
      health: () => ({ worker: worker.health(), chain: adapters.chain.health(),
        feeds: [...adapters.feeds.values()].map(feed => feed.health()) }) }, config.port, signal);
    defer("http", () => api.stop());
    await worker.run(signal);
  });
}
if (import.meta.main) {
  const log = (fault: Fault) => console.error(JSON.stringify({ time: new Date().toISOString(), ...fault }));
  await foreground(async signal => process.env.SOLSTOCK_DEMO === "devnet"
    ? runDemo(signal,await createDemoReference(process.env.SOLSTOCK_DEMO_ALPACA_FILE,log)) : runService(process.env, signal, log), log);
}
