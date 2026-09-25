import { readFileSync } from "node:fs";
import { Connection } from "@solana/web3.js";

export function readConnection(keyFile: string): Connection {
  const lines = readFileSync(keyFile, "utf8").split("\n");
  const entries = lines.filter((line) => /^(export )?API_HELIUS=/.test(line.trim()));
  if (entries.length !== 1) throw new Error("Expected one API_HELIUS credential");
  const entry = entries[0];
  if (entry === undefined) throw new Error("Credential entry missing");
  let key = entry.slice(entry.indexOf("=") + 1).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error("Invalid Helius key format");
  const endpoint = `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return new Connection(endpoint, {
    commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: Object.assign(async (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      } catch {
        throw new Error("Helius RPC transport failure; endpoint credentials redacted");
      }
      if (!response.ok) throw new Error(`Helius RPC HTTP ${response.status}`);
      return response;
    }, { preconnect: fetch.preconnect }),
  });
}
