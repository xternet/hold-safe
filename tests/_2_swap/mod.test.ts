import { describe, expect, test } from "bun:test";
import { runRouteCase } from "./_1_fixture/mod";

describe("M01: real mainnet CLMM snapshot, local balances only", () => {
  test("owner-signed baseline executes against the real DEX binary", () => {
    const result = runRouteCase({ mode: "owner" });
    expect(result.failed, result.logs.join("\n")).toBe(false);
    expect(result.sourceBefore - result.sourceAfter).toBe(result.amount);
    expect(result.outputAfter).toBeGreaterThan(0n);
  });

  test("ordinary delegation alone does not satisfy CLMM token-owner check", () => {
    const result = runRouteCase({ mode: "delegate" });
    expect(result.failed).toBe(true);
    expect(result.logs.join("\n")).toContain("ConstraintTokenOwner");
    expect(result.sourceAfter).toBe(result.sourceBefore);
    expect(result.outputAfter).toBe(0n);
  });

  test("approved PDA stages and exits atomically without owner signature", () => {
    const result = runRouteCase({ mode: "pda" });
    const baseline = runRouteCase({ mode: "owner" });
    expect(result.failed, result.logs.join("\n")).toBe(false);
    expect(result.sourceBefore - result.sourceAfter).toBe(result.amount);
    expect(result.outputAfter).toBe(baseline.outputAfter);
    expect(result.stagingAfter).toBe(0n);
    expect(result.allowanceAfter).toBe(0n);
  });

  test("insufficient delegation cannot fund staging or change user balances", () => {
    const result = runRouteCase({ mode: "pda", allowance: 1n });
    expect(result.failed).toBe(true);
    expect(result.sourceAfter).toBe(result.sourceBefore);
    expect(result.stagingAfter).toBe(0n);
    expect(result.outputAfter).toBe(0n);
    expect(result.allowanceAfter).toBe(1n);
  });

  test("unmet swap floor rolls staging and delegate allowance back", () => {
    const result = runRouteCase({ mode: "pda", floor: (1n << 64n) - 1n });
    expect(result.failed).toBe(true);
    expect(result.sourceAfter).toBe(result.sourceBefore);
    expect(result.stagingAfter).toBe(0n);
    expect(result.outputAfter).toBe(0n);
    expect(result.allowanceAfter).toBe(result.amount);
  });
});
