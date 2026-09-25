import { expect, test } from "bun:test";
import { armed, expire, journalFixture, preparation } from "../_shared/mod";

// Actual PostgreSQL backend termination while the application transaction is
// blocked after inserting the attempt, before it can write its event/commit.
test("database connection loss before commit rolls back all intent and logs a visible fault", async () => {
  const f = await journalFixture();
  let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
  try {
    const a = f.open(), { claim, policy } = await armed(a.journal), plan = await preparation(policy);
    await f.admin.unsafe(`CREATE FUNCTION solstock_guard.test_pause_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(73040702); RETURN NEW; END $$;
      CREATE TRIGGER test_pause_event BEFORE INSERT ON solstock_guard.events
        FOR EACH ROW WHEN (NEW.kind='ATTEMPT_PREPARED') EXECUTE FUNCTION solstock_guard.test_pause_event();`);
    await f.admin`select pg_advisory_lock(73040702)`;
    pending = Promise.allSettled([a.journal.prepare(claim, plan)]);
    let backend: number | undefined;
    for (let i = 0; i < 100; i++) {
      const rows = await f.admin`select pid from pg_stat_activity where datname=current_database()
        and application_name='solstock-journal-tests' and wait_event='advisory' and pid<>pg_backend_pid()`;
      if (rows[0] !== undefined) { backend = rows[0].pid; break; }
      await Bun.sleep(10);
    }
    expect(backend).toBeDefined();
    if (backend === undefined) throw new Error("Journal transaction never reached commit barrier");
    const [terminated] = await f.admin`select pg_terminate_backend(${backend}) as terminated`;
    expect(terminated!.terminated).toBe(true);
    expect((await pending)[0]!.status).toBe("rejected");
    expect((await f.admin`select id from solstock_guard.attempts`).length).toBe(0);
    expect((await f.admin`select id from solstock_guard.decisions`).length).toBe(0);
    expect((await f.open().journal.readPolicy(claim.policyDigest))!.state).toBe("ARMED");
    expect(f.faults).toHaveLength(1);
  } finally {
    await f.admin`select pg_advisory_unlock(73040702)`;
    if (pending !== undefined) await pending;
    await f.close();
  }
});

test("takeover recovers committed bytes and rejects stale worker writes and immutable-byte edits", async () => {
  const f = await journalFixture();
  try {
    const a = f.open(), { claim, policy } = await armed(a.journal), plan = await preparation(policy);
    const saved = await a.journal.prepare(claim, plan);
    await expire(f.admin, claim);
    const b = f.open().journal, next = await b.claim(claim.policyDigest, "restarted", 10_000);
    expect(next).not.toBeNull();
    await expect(a.journal.submitted(claim, plan.id)).rejects.toThrow();
    await expect(a.journal.prepare(claim, await preparation(policy))).rejects.toThrow();
    expect(await b.latest(claim.policyDigest)).toEqual(saved);
    await b.submitted(next!, plan.id);
    const recovered = await b.latest(claim.policyDigest);
    expect(recovered!.signed.bytesBase64).toBe(plan.signed.bytesBase64);
    expect(recovered!.signed.nativeId).toBe(plan.signed.nativeId);
    await expect(f.admin`update solstock_guard.attempts set transaction_bytes=decode('ff','hex') where id=${plan.id}`.execute()).rejects.toThrow();
    expect((await b.latest(claim.policyDigest))!.signed).toEqual(plan.signed);
  } finally { await f.close(); }
});

test("late transaction failure is atomic and preparation forces synchronous durability", async () => {
  const f = await journalFixture();
  try {
    const a = f.open(), { claim, policy } = await armed(a.journal), plan = await preparation(policy);
    await f.admin.unsafe(`CREATE FUNCTION solstock_guard.test_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Injected failure after attempt insert'; END $$;
      CREATE TRIGGER test_reject_event BEFORE INSERT ON solstock_guard.events
        FOR EACH ROW WHEN (NEW.kind='ATTEMPT_PREPARED') EXECUTE FUNCTION solstock_guard.test_reject_event();`);
    await expect(a.journal.prepare(claim, plan)).rejects.toThrow();
    expect((await f.admin`select id from solstock_guard.attempts`).length).toBe(0);
    expect((await f.admin`select id from solstock_guard.decisions`).length).toBe(0);
    expect((await a.journal.readPolicy(claim.policyDigest))!.state).toBe("ARMED");
    await f.admin.unsafe(`DROP TRIGGER test_reject_event ON solstock_guard.events;
      CREATE FUNCTION solstock_guard.test_durability() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF current_setting('synchronous_commit') <> 'on' THEN RAISE EXCEPTION 'Durability not enabled'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_durability BEFORE INSERT ON solstock_guard.attempts FOR EACH ROW EXECUTE FUNCTION solstock_guard.test_durability();`);
    await a.sql`set synchronous_commit=off`;
    const saved = await a.journal.prepare(claim, plan);
    expect(saved.signed).toEqual(plan.signed);
    expect((await f.admin`select id from solstock_guard.attempts`).length).toBe(1);
    expect(f.faults).toHaveLength(1);
  } finally { await f.close(); }
});
