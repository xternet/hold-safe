import { expect, test } from "bun:test";
import { catalogFixture } from "../../../_kernel/_test/mod";
import { makeDraft, decimalRaw } from "./mod";

const fields = { source: "source", recipient: "recipient", amountRaw: "9007199254740993", minimumOutput: "123.456789",
  thresholdPercent: "3", persistenceSeconds: "3", slippagePercent: "1", lifetimeHours: "24" };
const coverage = () => ({ catalog: catalogFixture(), keeper: "keeper", guard: "guard" });
test("form produces exact policy units and binds the selected route", () => {
  const policy = makeDraft(coverage(), "owner", "route-1", fields, 1800000000000);
  expect(policy.amountRaw).toBe("9007199254740993");
  expect(policy.minimumOutputRaw).toBe("123456789");
  expect(policy.rule.thresholdBps).toBe(300);
  expect(policy.rule.persistenceMs).toBe(3000);
  expect(policy.expiresAt).toBe(1800086400);
  expect(policy.coverage.program).toBe("program");
  expect(policy.orderId).toMatch(/^[a-f0-9]{64}$/);
  expect(makeDraft(coverage(), "owner", "route-1", fields, 1800000000000).orderId).not.toBe(policy.orderId);
});
test("form refuses precision loss, guessed units and unsupported routes", () => {
  expect(decimalRaw("9007199254740993.000001", 6)).toBe("9007199254740993000001");
  for (const amount of ["1e3", "1.0000001", "-1", " 1", "NaN", "01", "0"]) expect(() => decimalRaw(amount, 6)).toThrow();
  for (const change of [{ amountRaw: "1.5" }, { thresholdPercent: "0" }, { slippagePercent: "101" },
    { lifetimeHours: "0" }, { persistenceSeconds: "1e3" }]) {
    expect(() => makeDraft(coverage(), "owner", "route-1", { ...fields, ...change }, 1800000000000)).toThrow();
  }
  expect(() => makeDraft(coverage(), "owner", "unknown-route", fields, 1800000000000)).toThrow();
});
