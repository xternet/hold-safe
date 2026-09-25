import { expect, test } from "bun:test";
import { binaryMultiplier } from "./mod";

test("binary64 multiplier becomes an exact rational without decimal rounding", () => {
  expect(binaryMultiplier(1.5)).toEqual({ n: 3n, d: 2n });
  expect(binaryMultiplier(1 + Number.EPSILON)).toEqual({ n: 4503599627370497n, d: 4503599627370496n });
  expect(binaryMultiplier(Number.MIN_VALUE)).toEqual({ n: 1n, d: 2n ** 1074n });
  for (const invalid of [0, -1, NaN, Infinity]) expect(() => binaryMultiplier(invalid)).toThrow();
});
