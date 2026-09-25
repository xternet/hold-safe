import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("PostgreSQL migration enforces policy domain and unresolved-attempt uniqueness", () => {
  const database = process.env.SOLSTOCK_TEST_DATABASE;
  if (database === undefined || !/^solstock_guard_test[a-z0-9_]*$/.test(database)) {
    throw new Error("Set SOLSTOCK_TEST_DATABASE to a dedicated solstock_guard_test database");
  }
  const migration = readFileSync("migrations/001_initial.sql", "utf8");
  const cases = readFileSync("tests/_5_storage/cases.sql", "utf8");
  const result = Bun.spawnSync(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", database], {
    stdin: Buffer.from(`BEGIN;\n${migration}\n${cases}\nROLLBACK;\n`),
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString()).toContain("ROLLBACK");
});
