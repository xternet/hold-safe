import { expect, test } from "bun:test";
import { validateCatalog } from "./mod";
import { catalogFixture } from "../_test/mod";

test("validated catalog preserves exact asset and route coverage", () => {
  const catalog = validateCatalog(catalogFixture());
  expect(catalog.assets.length).toBe(2);
  expect(catalog.routes.length).toBe(1);
});

test("validated catalog is isolated from later caller mutation", () => {
  const source = catalogFixture();
  const frozen = validateCatalog(source);
  source.assets[0]!.symbol = "edited";
  expect(frozen.assets[0]!.symbol).toBe("STOCK");
  expect(() => { frozen.routes[0]!.program = "edited"; }).toThrow();
});

test("duplicate asset identity, missing source and unsupported profiles are rejected", () => {
  for (const mutate of [
    (c: ReturnType<typeof catalogFixture>) => { c.assets.push(c.assets[0]!); },
    (c: ReturnType<typeof catalogFixture>) => { c.assets[0]!.reference.provider = "unknown"; },
    (c: ReturnType<typeof catalogFixture>) => { c.assets[0]!.profile = "unimplemented-token-behavior"; },
    (c: ReturnType<typeof catalogFixture>) => { c.routes[0]!.venue = "unsupported-venue"; },
    (c: ReturnType<typeof catalogFixture>) => { c.routes[0]!.output.address = "unknown-asset"; },
  ]) {
    const catalog = catalogFixture();
    mutate(catalog);
    expect(() => validateCatalog(catalog)).toThrow();
  }
});

test("coverage cannot cross chain boundaries or invent metadata", () => {
  const catalog = catalogFixture();
  catalog.assets[0]!.decimals = -1;
  expect(() => validateCatalog(catalog)).toThrow();
  const wrong = catalogFixture();
  wrong.routes[0]!.input.chain.reference = "other-network";
  expect(() => validateCatalog(wrong)).toThrow();
});
