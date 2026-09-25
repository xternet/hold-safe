import { expect, test } from "bun:test";
import { scaledDisplay } from "./mod";
test("display floors scaled balances exactly, including values beyond safe Number integers", () => {
  expect(scaledDisplay("1000000", 8, { n: "1003", d: "1000" })).toBe("0.01003000");
  expect(scaledDisplay("9007199254740993", 6, { n: "1", d: "1" })).toBe("9007199254.74099300");
  expect(scaledDisplay("1", 8, { n: "3", d: "2" })).toBe("0.00000001");
  expect(scaledDisplay("0", 8, { n: "3", d: "2" })).toBe("0.00000000");
  for (const decimals of [-1, 1.5, 256]) expect(() => scaledDisplay("1", decimals, { n: "1", d: "1" })).toThrow();
  expect(() => scaledDisplay("1", 8, { n: "0", d: "1" })).toThrow();
  expect(() => scaledDisplay("1", 8, { n: "1", d: "0" })).toThrow();
});
