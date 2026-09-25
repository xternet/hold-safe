import { useEffect, useState } from "react";
import { validateCatalog, type Catalog, type Health } from "../../../_kernel/mod";
export type Coverage = { catalog: Catalog; keeper: string; guard: string };
export type ServiceHealth = { worker: { healthy: boolean; checkedAt: number; active: number }; chain: Health; feeds: Health[] };
export async function request<T>(path: string, data?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: data === undefined ? "GET" : "POST", cache: "no-store",
    headers: { ...(data === undefined ? {} : { "content-type": "application/json" }), ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: signal === undefined ? AbortSignal.timeout(30000) : AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Service request failed (${response.status})`);
  return result as T;
}
export function useService() {
  const [coverage, setCoverage] = useState<Coverage | null>(null), [health, setHealth] = useState<ServiceHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      try {
        const [current, status] = await Promise.all([request<Coverage>("coverage", undefined, undefined, controller.signal), request<ServiceHealth>("health", undefined, undefined, controller.signal)]);
        const catalog = validateCatalog(current.catalog);
        if (typeof current.keeper !== "string" || typeof current.guard !== "string" || typeof status.worker?.healthy !== "boolean" ||
            typeof status.chain?.healthy !== "boolean" || !Array.isArray(status.feeds)) throw new Error("Invalid service response");
        const sources = [status.chain, ...status.feeds];
        if (!Number.isSafeInteger(status.worker.checkedAt) || !Number.isSafeInteger(status.worker.active) || status.worker.active < 0 ||
            sources.some(item => typeof item.source !== "string" || typeof item.reason !== "string" ||
              typeof item.healthy !== "boolean" || !Number.isSafeInteger(item.checkedAt))) throw new Error("Invalid service health");
        if (!controller.signal.aborted) { setCoverage({ ...current, catalog }); setHealth(status); setError(null); }
      } catch (cause) {
        if (!controller.signal.aborted) { setHealth(null); setError(cause instanceof Error ? cause.message : "Service unavailable"); }
      } finally { if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 5000); }
    }
    void refresh(); return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, []);
  return { coverage, health, error };
}
