import { expect, test } from "bun:test";
import { journalFixture } from "../../../tests/_5_storage/_shared/mod";
import { openStorage } from "./mod";

function destination() {
  const base = process.env.SOLSTOCK_TEST_DATABASE;
  if (base === undefined || !/^solstock_guard_test[a-z0-9_]*$/.test(base)) throw new Error("Dedicated database required");
  return { socket: "/var/run/postgresql/.s.PGSQL.5432", database: `${base}_journal`, username: "multi" };
}

test("startup checks real schema and enforces bounded durable sessions", async () => {
  const f = await journalFixture();
  try {
    const faults: unknown[] = [];
    const storage = await openStorage(destination(), fault => faults.push(fault));
    try {
      const [settings] = await storage.sql`select current_setting('statement_timeout') as statement,
        current_setting('lock_timeout') as lock, current_setting('synchronous_commit') as sync`;
      expect(settings).toEqual({ statement: "5s", lock: "2s", sync: "on" });
      expect(faults).toEqual([]);
      const rows = await storage.sql`select version from solstock_guard.schema_versions order by version`;
      expect(rows.map((row: { version: number }) => row.version)).toEqual([1, 2]);
    } finally { await storage.close(); }
  } finally { await f.close(); }
});

test("startup rejects incomplete or future schema without migrating and closes its pool", async () => {
  const f = await journalFixture();
  try {
    for (const version of [2, 3]) {
      if (version === 2) await f.admin`delete from solstock_guard.schema_versions where version=2`;
      else await f.admin`insert into solstock_guard.schema_versions(version) values (2),(3)`;
      const faults: unknown[] = [];
      await expect(openStorage(destination(), fault => faults.push(fault))).rejects.toThrow("Database readiness failed");
      expect(faults).toHaveLength(1);
      const deadline = Date.now() + 1500;
      let count: number;
      do {
        const [connections] = await f.admin`select count(*)::int as count from pg_stat_activity
          where datname=current_database() and application_name='solstock-guard'`;
        count = connections.count;
        if (count === 0) break;
        await Bun.sleep(20);
      } while (Date.now() < deadline);
      expect(count).toBe(0);
      const rows = await f.admin`select version from solstock_guard.schema_versions order by version`;
      expect(rows.map((row: { version: number }) => row.version)).toEqual(version === 2 ? [1] : [1, 2, 3]);
    }
  } finally { await f.close(); }
});

test("startup rejects an unavailable database and redacts connection details", async () => {
  const faults: unknown[] = [];
  const secret = "never-print-this-password";
  await expect(openStorage({ url: `postgres://nonexistent:${secret}@127.0.0.1:1/unavailable` }, fault => faults.push(fault)))
    .rejects.toThrow("Database readiness failed");
  expect(faults).toHaveLength(1);
  expect(JSON.stringify(faults)).not.toContain(secret);
  expect(JSON.stringify(faults)).not.toContain("postgres://");
});


test("startup rejects a missing version table without repairing the schema", async () => {
  const f = await journalFixture();
  try {
    await f.admin`alter table solstock_guard.schema_versions rename to saved_versions`;
    const faults: unknown[] = [];
    await expect(openStorage(destination(), fault => faults.push(fault))).rejects.toThrow("Database readiness failed");
    expect(faults).toHaveLength(1);
    const [table] = await f.admin`select to_regclass('solstock_guard.schema_versions') as name`;
    expect(table.name).toBeNull();
  } finally { await f.close(); }
});
