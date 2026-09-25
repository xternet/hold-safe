import { expect, test } from "bun:test";
import { withResources } from "./mod";

test("lifecycle drains resources in reverse order even after cleanup failure", async () => {
  const calls: string[] = [], faults: unknown[] = [];
  await expect(withResources(fault => faults.push(fault), async defer => {
    defer("database", async () => { calls.push("database"); });
    defer("calendar", async () => { calls.push("calendar"); throw new Error("secret upstream details"); });
    defer("worker", async () => { await Bun.sleep(10); calls.push("worker"); });
  })).rejects.toThrow("Resource cleanup failed");
  expect(calls).toEqual(["worker", "calendar", "database"]);
  expect(faults).toHaveLength(1);
  expect(JSON.stringify(faults)).not.toContain("secret upstream details");
});

test("startup failure closes already acquired resources and preserves its error", async () => {
  const calls: string[] = [];
  await expect(withResources(() => { throw new Error("Unexpected cleanup fault"); }, async defer => {
    defer("database", async () => { calls.push("database"); });
    throw new Error("Expected startup rejection");
  })).rejects.toThrow("Expected startup rejection");
  expect(calls).toEqual(["database"]);
});
