import { expect, test } from "bun:test";
import { readConfig } from "./mod";

const env = () => ({
  API_ALPACA: "fixture-alpaca-key", API_ALPACA_SECRET: "fixture-alpaca-secret",
  SOLSTOCK_RPC_HTTP: "https://primary.example/rpc?api-key=fixture",
  SOLSTOCK_RPC_WS: "wss://primary.example/rpc?api-key=fixture",
  SOLSTOCK_BACKUP_RPC_HTTP: "https://backup.example/rpc?key=fixture",
  SOLSTOCK_DATABASE_URL: "postgres://user:fixture-password@localhost/solstock_guard",
  SOLSTOCK_KEEPER_FILE: "/private/keeper.json", SOLSTOCK_GUARD_MANIFEST: "/release/guard.json",
  SOLSTOCK_PUBLIC_ORIGIN: "https://guard.example", SOLSTOCK_PORT: "3401",
  SOLSTOCK_COMPUTE_UNITS: "1000000", SOLSTOCK_PRIORITY_MICROLAMPORTS: "0", SOLSTOCK_MAX_FEE_LAMPORTS: "10000",
});

test("explicit config preserves credentials and exact fee units without process mutation", () => {
  const input = env(), copy = { ...input }, config = readConfig(input);
  expect(input).toEqual(copy);
  expect(config.alpaca).toEqual({ key: input.API_ALPACA, secret: input.API_ALPACA_SECRET });
  expect(config.fees).toEqual({ computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" });
  expect(config.database).toEqual({ url: input.SOLSTOCK_DATABASE_URL });
  expect(config.origin).toBe("https://guard.example");
  expect(config.port).toBe(3401);
});

test("every required setting is explicit and missing errors contain no credentials", () => {
  for (const key of Object.keys(env())) {
    const input: Record<string, string> = env(); delete input[key];
    expect(() => readConfig(input)).toThrow(key);
  }
  const input = env(); input.SOLSTOCK_RPC_HTTP = "not-a-url-secret";
  try { readConfig(input); throw new Error("Accepted invalid endpoint"); }
  catch (error) {
    expect(String(error)).toContain("SOLSTOCK_RPC_HTTP");
    expect(String(error)).not.toContain(input.SOLSTOCK_RPC_HTTP);
    expect(String(error)).not.toContain(input.API_ALPACA_SECRET);
  }
});

test("config rejects insecure/ambiguous endpoints, duplicate RPC origins and invalid fee bounds", () => {
  const invalid: [keyof ReturnType<typeof env>, string][] = [
    ["SOLSTOCK_RPC_HTTP", "http://primary.example/rpc"],
    ["SOLSTOCK_RPC_WS", "ws://primary.example/rpc"],
    ["SOLSTOCK_BACKUP_RPC_HTTP", "https://primary.example/other"],
    ["SOLSTOCK_RPC_HTTP", "https://user:secret@primary.example"],
    ["SOLSTOCK_RPC_HTTP", "https://primary.example/#secret"],
    ["SOLSTOCK_PUBLIC_ORIGIN", "http://guard.example"],
    ["SOLSTOCK_PUBLIC_ORIGIN", "https://guard.example/path"],
    ["SOLSTOCK_PUBLIC_ORIGIN", "https://guard.example?key=secret"],
    ["SOLSTOCK_KEEPER_FILE", "relative.json"], ["SOLSTOCK_GUARD_MANIFEST", "../guard.json"],
    ["SOLSTOCK_DATABASE_URL", "mysql://localhost/db"], ["SOLSTOCK_DATABASE_URL", "postgres://localhost/"],
    ["SOLSTOCK_COMPUTE_UNITS", "1400001"], ["SOLSTOCK_COMPUTE_UNITS", "1e6"],
    ["SOLSTOCK_PRIORITY_MICROLAMPORTS", "18446744073709551616"],
    ["SOLSTOCK_MAX_FEE_LAMPORTS", "0"], ["SOLSTOCK_MAX_FEE_LAMPORTS", "1.5"],
    ["SOLSTOCK_PORT", "65536"], ["SOLSTOCK_PORT", "0"], ["API_ALPACA", " padded "],
  ];
  for (const [key, value] of invalid) expect(() => readConfig({ ...env(), [key]: value }), key).toThrow();
  expect(() => readConfig({ ...env(), SOLSTOCK_PRIORITY_MICROLAMPORTS: "20000" })).toThrow("SOLSTOCK_MAX_FEE_LAMPORTS");
});

test("local integration accepts loopback endpoints without introducing another chain", () => {
  const config = readConfig({ ...env(), SOLSTOCK_RPC_HTTP: "http://127.0.0.1:3402",
    SOLSTOCK_BACKUP_RPC_HTTP: "http://127.0.0.1:3403", SOLSTOCK_RPC_WS: "ws://127.0.0.1:3402",
    SOLSTOCK_PUBLIC_ORIGIN: "http://127.0.0.1:3401" });
  expect(config.origin).toBe("http://127.0.0.1:3401");
});
