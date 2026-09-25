import type { Catalog, Fault, PolicyWorkflowPort, WalletIdentityPort, WalletInventoryPort } from "../../../_kernel/mod";
export type ApiOptions = { origin: string; identity: WalletIdentityPort; workflow: PolicyWorkflowPort;
  inventory: WalletInventoryPort; catalog: Catalog; keeper: string; guard: string; health(): unknown; log(fault: Fault): void; now(): number };
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'" } });
}
export async function body(request: Request, log: ApiOptions["log"]): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new HttpError(415, "JSON required");
  if (request.body === null) throw new HttpError(400, "Body required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let timedOut = false, cancellation: Promise<void> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    cancellation = reader.cancel("Body timeout").catch(() => {
      log({ code: "UNAVAILABLE", message: "Request body cancellation failed", retryable: true, context: { component: "http-body" } });
    });
  }, 3000);
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16384) { await reader.cancel(); throw new HttpError(413, "Body too large"); }
      chunks.push(chunk.value);
    }
    if (timedOut) throw new HttpError(408, "Body timeout");
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new HttpError(400, "Invalid JSON"); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Object required");
    return parsed as Record<string, unknown>;
  } finally { clearTimeout(timer); await cancellation; reader.releaseLock(); }
}
export function fields(input: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(input).length !== names.length || names.some(name => !(name in input))) throw new HttpError(400, "Unexpected request fields");
}
export function text(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== "string" || input[key].length > 4096) throw new HttpError(400, "Invalid request field");
  return input[key];
}
export function bearer(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new HttpError(401, "Sign-in required");
  return header.slice(7);
}
