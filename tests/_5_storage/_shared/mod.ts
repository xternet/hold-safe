import { SQL } from "bun";
import { readFileSync } from "node:fs";
import { catalogFixture, policyFixture } from "../../../src/_kernel/_test/mod";
import { policyDigest, type Claim, type Policy, type Preparation } from "../../../src/_kernel/mod";
import { createJournal } from "../../../src/_shared/_0_store/mod";

export async function journalFixture() {
  const base = process.env.SOLSTOCK_TEST_DATABASE;
  if (base === undefined || !/^solstock_guard_test[a-z0-9_]*$/.test(base)) throw new Error("Dedicated test database required");
  const database = `${base}_journal`;
  const options = { path: "/var/run/postgresql/.s.PGSQL.5432", database, username: "multi", max: 4, connectionTimeout: 3,
    connection: { application_name: "solstock-journal-tests", statement_timeout: 3000, client_min_messages: "warning" } };
  const admin = new SQL({ ...options, max: 1 });
  try {
    await admin`select pg_advisory_lock(73040701)`;
    const existing = await admin`select 1 from pg_namespace where nspname='solstock_guard'`;
    if (existing.length !== 0) throw new Error("Journal fixture schema already exists; inspect before cleanup");
    await admin.begin(async tx => {
      await tx.unsafe(readFileSync("migrations/001_initial.sql", "utf8"));
      await tx.unsafe(readFileSync("migrations/002_journal.sql", "utf8"));
    });
  } catch (error) {
    await admin.close({ timeout: 1 }); throw error;
  }
  const clients: SQL[] = [], faults: unknown[] = [];
  function open() {
    const sql = new SQL(options); clients.push(sql);
    return { sql, journal: createJournal(sql, catalogFixture(), fault => faults.push(fault)) };
  }
  return { admin, open, faults, async close() {
    const closed = await Promise.allSettled(clients.map(sql => sql.close({ timeout: 1 })));
    try {
      await admin.unsafe("DROP SCHEMA solstock_guard CASCADE");
      const [released] = await admin`select pg_advisory_unlock(73040701) as released`;
      if (released.released !== true) throw new Error("Fixture advisory lock was not owned");
    } finally { await admin.close({ timeout: 1 }); }
    const failures = closed.filter(result => result.status === "rejected");
    if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason), "Fixture connection cleanup failed");
  } };
}
export async function armed(journal: ReturnType<typeof createJournal>, worker = "worker-a", policy: Policy = policyFixture()) {
  const record = await journal.putPolicy(policy), claim = await journal.claim(record.digest, worker, 10_000);
  if (claim === null) throw new Error("Fixture claim unavailable");
  const evidence = { adapter: "test-native", version: 1, serialized: JSON.stringify({ active: true }) };
  await journal.transition(claim, "DRAFT", "ARMING", evidence);
  await journal.transition(claim, "ARMING", "ARMED", evidence);
  return { claim, policy, evidence };
}
export async function preparation(policy: Policy): Promise<Preparation> {
  const digest = await policyDigest(policy);
  // Synthetic journal-only bytes: native signature validation belongs to the
  // execution adapter, not the chain-independent persistence tests.
  return { id: crypto.randomUUID(), decisionId: crypto.randomUUID(), previousId: null,
    signed: { chain: policy.chain, policyDigest: digest, nativeId: crypto.randomUUID(),
      bytesBase64: Buffer.from(crypto.getRandomValues(new Uint8Array(128))).toString("base64"),
      validity: { adapter: "test-native", version: 1, serialized: JSON.stringify({ lastValidHeight: 1234 }) } },
    execution: { adapter: "test-simulation", version: 1, serialized: JSON.stringify({ units: 123 }) },
    decision: { policyDigest: digest, rule: "divergence@1", evaluatedAtMs: Date.now(), state: "TRIGGERED", reason: "Journal fixture",
      evidence: { observationIds: ["stock-1", "usd-1", "holding-1"], sourceTimes: [Date.now()], quoteId: "quote-1", elapsedMs: 3000,
        shares: { n: 9007199254740993n, d: 100000000n } } } };
}
export async function expire(admin: SQL, claim: Claim) {
  await admin`update solstock_guard.policy_claims set lease_until=clock_timestamp()-interval '1 second' where policy_id=${claim.policyDigest}`;
}
