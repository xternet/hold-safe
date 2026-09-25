import { isAbsolute } from "node:path";

export interface RuntimeConfig {
  alpaca: { key: string; secret: string };
  primary: string;
  websocket: string;
  backup: string;
  database: { url: string };
  keeperFile: string;
  guardManifest: string;
  origin: string;
  port: number;
  fees: { computeUnitLimit: number; microLamports: string; maxFeeLamports: string };
}

export function readConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  function invalid(name: string): never { throw new Error(`Missing or invalid configuration: ${name}`); }
  function required(name: string): string {
    const value = env[name];
    if (value === undefined || value.length === 0 || value.trim() !== value || /[\x00-\x1f\x7f]/.test(value)) invalid(name);
    return value;
  }
  function endpoint(name: string, secure: string, local: string): URL {
    const value = required(name);
    let url: URL;
    try { url = new URL(value); } catch { return invalid(name); }
    if (url.username !== "" || url.password !== "" || url.hash !== "" ||
        (url.protocol !== secure && !(url.protocol === local && url.hostname === "127.0.0.1"))) invalid(name);
    return url;
  }
  function path(name: string): string {
    const value = required(name);
    if (!isAbsolute(value)) invalid(name);
    return value;
  }
  function integer(name: string, maximum: bigint, zero = false): string {
    const value = required(name);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20) invalid(name);
    const parsed = BigInt(value);
    if (parsed > maximum || (!zero && parsed === 0n)) invalid(name);
    return value;
  }
  const primary = endpoint("SOLSTOCK_RPC_HTTP", "https:", "http:");
  const backup = endpoint("SOLSTOCK_BACKUP_RPC_HTTP", "https:", "http:");
  if (primary.origin === backup.origin) invalid("SOLSTOCK_BACKUP_RPC_HTTP");
  const websocket = endpoint("SOLSTOCK_RPC_WS", "wss:", "ws:");
  const origin = endpoint("SOLSTOCK_PUBLIC_ORIGIN", "https:", "http:");
  if (origin.pathname !== "/" || origin.search !== "") invalid("SOLSTOCK_PUBLIC_ORIGIN");
  const database = required("SOLSTOCK_DATABASE_URL");
  let databaseUrl: URL;
  try { databaseUrl = new URL(database); } catch { return invalid("SOLSTOCK_DATABASE_URL"); }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || databaseUrl.pathname.length < 2 || databaseUrl.hash !== "") {
    invalid("SOLSTOCK_DATABASE_URL");
  }
  const computeUnitLimit = Number(integer("SOLSTOCK_COMPUTE_UNITS", 1400000n));
  const microLamports = integer("SOLSTOCK_PRIORITY_MICROLAMPORTS", 0xffffffffffffffffn, true);
  const maxFeeLamports = integer("SOLSTOCK_MAX_FEE_LAMPORTS", BigInt(Number.MAX_SAFE_INTEGER));
  if ((BigInt(computeUnitLimit) * BigInt(microLamports) + 999999n) / 1000000n >= BigInt(maxFeeLamports)) {
    invalid("SOLSTOCK_MAX_FEE_LAMPORTS");
  }
  return {
    alpaca: { key: required("API_ALPACA"), secret: required("API_ALPACA_SECRET") },
    primary: primary.href, websocket: websocket.href, backup: backup.href, database: { url: database },
    keeperFile: path("SOLSTOCK_KEEPER_FILE"), guardManifest: path("SOLSTOCK_GUARD_MANIFEST"),
    origin: origin.origin, port: Number(integer("SOLSTOCK_PORT", 65535n)),
    fees: { computeUnitLimit, microLamports, maxFeeLamports },
  };
}
