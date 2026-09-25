import { expect, test } from "bun:test";
import { catalogFixture, policyFixture } from "../../../src/_kernel/_test/mod";
import { type Catalog, type Policy } from "../../../src/_kernel/mod";
import { createJournal } from "../../../src/_shared/_0_store/mod";
import { journalFixture } from "../_shared/mod";

test("owner discovery paginates without leaking another owner or chain domain", async () => {
  const f = await journalFixture();
  try {
    const { sql, journal } = f.open(), policy = policyFixture();
    const records = await Promise.all([1, 2, 3].map(index => journal.putPolicy({ ...policy,
      source: `source-${index}`, orderId: index.toString(16).padStart(64, "0") })));
    await journal.putPolicy({ ...policy, owner: "other-owner", orderId: "ff".repeat(32) });
    // Separate synthetic domain exercises the real shared persistence boundary.
    const foreignCatalog = JSON.parse(JSON.stringify(catalogFixture()).replaceAll("unit-test-network", "other-network")) as Catalog;
    const foreignPolicy = JSON.parse(JSON.stringify(policy).replaceAll("unit-test-network", "other-network")) as Policy;
    await createJournal(sql, foreignCatalog, e => f.faults.push(e)).putPolicy(foreignPolicy);
    const claim = await journal.claim(records[0]!.digest, "terminal-owner-fixture", 60000);
    if (claim === null) throw new Error("Fixture claim missing");
    const evidence = { adapter: "owner-list-fixture", version: 1, serialized: "{}" };
    await journal.transition(claim, "DRAFT", "ARMING", evidence);
    await journal.transition(claim, "ARMING", "EXPIRED", evidence);
    await journal.release(claim);
    const expected = records.map(row => row.digest).sort();
    const first = await journal.scanOwner(policy.chain, policy.owner, null, 2);
    expect(first.map(row => row.digest)).toEqual(expected.slice(0, 2));
    const next = await journal.scanOwner(policy.chain, policy.owner, first[1]!.digest, 2);
    expect(next.map(row => row.digest)).toEqual(expected.slice(2));
    expect([...first, ...next].find(row => row.digest === records[0]!.digest)?.state).toBe("EXPIRED");
    expect(await journal.scanOwner(policy.chain, "unknown-owner", null, 2)).toEqual([]);
    expect((await journal.scanOwner(foreignPolicy.chain, policy.owner, null, 2))).toHaveLength(1);
    for (const limit of [0, 51, 1.5]) await expect(journal.scanOwner(policy.chain, policy.owner, null, limit)).rejects.toThrow();
    await expect(journal.scanOwner(policy.chain, policy.owner, "invalid", 2)).rejects.toThrow();
  } finally { await f.close(); }
}, 15000);
