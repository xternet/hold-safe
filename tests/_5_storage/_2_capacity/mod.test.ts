import { expect, test } from "bun:test";
import { policyFixture } from "../../../src/_kernel/_test/mod";
import { journalFixture } from "../_shared/mod";

test("concurrent admission enforces 128 monitored policies and releases terminal capacity", async () => {
  const f = await journalFixture();
  try {
    const { journal } = f.open(), evidence = { adapter: "admission-fixture", version: 1, serialized: "{}" };
    const records = await Promise.all(Array.from({ length: 129 }, (_, index) => journal.putPolicy({ ...policyFixture(),
      source: `source-${index}`, orderId: (index + 1).toString(16).padStart(64, "0") })));
    const claims = await Promise.all(records.map(record => journal.claim(record.digest, "admission-test", 60000)));
    if (claims.some(claim => claim === null)) throw new Error("Fixture could not claim a policy");
    for (let index = 0; index < 127; index++) await journal.transition(claims[index]!, "DRAFT", "ARMING", evidence);
    const attempts = await Promise.allSettled([127, 128].map(index => journal.transition(claims[index]!, "DRAFT", "ARMING", evidence)));
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(result => result.status === "rejected")).toHaveLength(1);
    const [count] = await f.admin`select count(*)::int as active from solstock_guard.policies where state='ARMING'`;
    expect(count.active).toBe(128);
    await journal.transition(claims[0]!, "ARMING", "EXPIRED", evidence);
    const rejected = attempts.findIndex(result => result.status === "rejected") + 127;
    await journal.transition(claims[rejected]!, "DRAFT", "ARMING", evidence);
    expect((await journal.readPolicy(records[rejected]!.digest))?.state).toBe("ARMING");
    await Promise.all(claims.map(claim => journal.release(claim!)));
  } finally { await f.close(); }
}, 15000);
