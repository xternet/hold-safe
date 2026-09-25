import { expect, test } from "bun:test";
import { copyValue } from "./mod";

test("domain copies preserve BigInts and shared references without corrupting later objects", () => {
  const shared = { name: "asset", amount: 9007199254740993n };
  const original = { n: 1n, a: shared, b: shared, list: [shared, { ratio: { n: 3n, d: 2n } }] };
  const copy = copyValue(original);
  expect(copy).toEqual(original); expect(copy.a).toBe(copy.b); expect(copy.a).not.toBe(shared);
  copy.a.name = "changed"; expect(original.a.name).toBe("asset");
  expect(() => copyValue(new Date())).toThrow();
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  expect(() => copyValue(cycle)).toThrow();
});
