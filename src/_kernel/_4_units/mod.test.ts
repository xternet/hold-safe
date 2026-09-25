import { expect, test } from "bun:test";
import { decimal, ratio, add, multiply, divide, compare, floor, units, divergenceBps } from "./mod";

test("decimal parsing preserves large integers and rejects guessed values", () => {
  expect(decimal("9007199254740993.01")).toEqual(ratio(900719925474099301n, 100n));
  for (const invalid of ["", "NaN", "Infinity", " 1", "1e3", "1.", ".5"]) {
    expect(() => decimal(invalid)).toThrow();
  }
  expect(() => ratio(1n, 0n)).toThrow();
  expect(() => units(1n, -1)).toThrow();
});

test("rounding is mathematical floor, including negative discount values", () => {
  expect(floor(ratio(-1n, 3n))).toBe(-1n);
  expect(floor(ratio(-6n, 3n))).toBe(-2n);
  expect(floor(ratio(8n, 3n))).toBe(2n);
});

test("small rational arithmetic matches independent cross-product checks", () => {
  for (let a = -7n; a <= 7n; a++) for (let b = 1n; b <= 7n; b++) {
    for (let c = -7n; c <= 7n; c++) for (let d = 1n; d <= 7n; d++) {
      const left = ratio(a, b), right = ratio(c, d);
      const sum = add(left, right), product = multiply(left, right);
      expect(sum.n * b * d).toBe((a * d + c * b) * sum.d);
      expect(product.n * b * d).toBe(a * c * product.d);
      const difference = a * d - c * b;
      expect(compare(left, right)).toBe(difference < 0n ? -1 : difference > 0n ? 1 : 0);
      if (c !== 0n) {
        const quotient = divide(left, right);
        expect(quotient.n * b * c).toBe(a * d * quotient.d);
      }
    }
  }
});

test("raw units, multiplier, stock bid and output USD all affect divergence", () => {
  // 2 tokens * 1.25 shares * $100 = $250; 240 USDC * $0.99 = $237.60.
  const reference = multiply(multiply(units(200_000_000n, 8), decimal("1.25")), decimal("100"));
  const exit = multiply(units(240_000_000n, 6), decimal("0.99"));
  expect(divergenceBps(reference, exit)).toEqual(ratio(496n, 1n));
  expect(() => divergenceBps(ratio(0n, 1n), exit)).toThrow();
});
