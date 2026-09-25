import { Connection } from "@solana/web3.js";
import type { Fault } from "../../../../_kernel/mod";

export function readConnection(endpoint: string, provider: string, log: (fault: Fault) => void): Connection {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) throw new Error("RPC requires HTTPS");
  return new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true,
    fetch: Object.assign(async (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      let response: Response;
      try { response = await fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(4000) }); }
      catch {
        log({ code: "UNAVAILABLE", message: "RPC transport failure", retryable: true, context: { provider, receivedAtMs: String(Date.now()) } });
        throw new Error("RPC transport failure; credentials redacted");
      }
      if (!response.ok) {
        log({ code: "UNAVAILABLE", message: "RPC HTTP failure", retryable: true, context: { provider, status: String(response.status), receivedAtMs: String(Date.now()) } });
        await response.body?.cancel(); throw new Error(`RPC HTTP ${response.status}`);
      }
      return response;
    }, { preconnect: fetch.preconnect }),
  });
}
