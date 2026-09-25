import { createJournal } from "../../../src/_shared/_0_store/mod";
import { createPolicyWorkflow } from "../../../src/_4_authorization/mod";
import { createAuthorization } from "../../../src/_adapters/_0_solana/_1_authorize/mod";
import { authorizationFixture } from "../../_8_authorization/_shared/mod";
import { journalFixture } from "../../_5_storage/_shared/mod";
import { createWalletInventory } from "../../../src/_adapters/_0_solana/_6_inventory/mod";

export async function workflowFixture() {
  const f = await authorizationFixture(), db = await journalFixture();
  const journal = createJournal(db.open().sql, f.catalog, e => f.faults.push(e));
  const authorization = createAuthorization(f.connection, f.catalog, f.manifest,
    { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" }, f.route, e => f.faults.push(e), f.now);
  const workflow = createPolicyWorkflow({ catalog: f.catalog, journal, authorization, keeper: f.policy.keeper,
    guard: f.policy.guard, chain: f.policy.chain, now: f.now, log: e => f.faults.push(e) });
  const inventory = createWalletInventory(f.connection, f.catalog, e => f.faults.push(e), f.now);
  return { ...f, db, journal, workflow, inventory, async close() { await db.close(); await f.stop(); } };
}
