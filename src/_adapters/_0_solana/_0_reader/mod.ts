import type { Connection } from "@solana/web3.js";
import type { Catalog, ChainReader, Fault } from "../../../_kernel/mod";
import { HoldingReads } from "./_1_reads/mod";
import { AccountWatch } from "./_2_watch/mod";
import { HoldingMonitor } from "./_3_monitor/mod";

export function createSolanaReader(connection: Connection, websocket: string, catalog: Catalog,
  log: (fault: Fault) => void, now = Date.now): ChainReader {
  const reads = new HoldingReads(connection, catalog, log, now), watch = new AccountWatch(websocket, log, now);
  const monitor = new HoldingMonitor(reads, watch, catalog, log, now);
  return { chain: reads.chain, verifyNetwork: () => reads.verifyNetwork(), readHolding: policy => reads.readHolding(policy),
    subscribeHolding: (policy, observer) => monitor.subscribe(policy, observer), health: () => {
      const health = reads.health();
      if (health.healthy && !watch.health().healthy) return { ...health, reason: "Fresh RPC state; account stream inactive or degraded" };
      return health;
    } };
}
