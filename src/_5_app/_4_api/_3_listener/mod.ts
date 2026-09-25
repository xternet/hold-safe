import { staticAsset } from "../_4_static/mod";
import { ApiHandler } from "../_2_handler/mod";
import type { ApiOptions } from "../_shared/mod";

export function startApi(options: ApiOptions, port: number, signal: AbortSignal) {
  signal.throwIfAborted();
  const api = new ApiHandler(options);
  const server = Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: 16384, idleTimeout: 30, fetch: async request => {
    if (signal.aborted) return api.fetch(request);
    const asset = await staticAsset(request); return asset === null ? api.fetch(request) : asset;
  } });
  const stopAccepting = () => api.close();
  signal.addEventListener("abort", stopAccepting, { once: true });
  return { url: server.url, async stop() {
    signal.removeEventListener("abort", stopAccepting); api.close(); await server.stop(false);
  } };
}
