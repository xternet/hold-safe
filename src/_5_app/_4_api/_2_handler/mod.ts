import { AuthenticationError, WalletSessions } from "../_0_auth/mod";
import { route } from "../_1_routes/mod";
import { HttpError, json, type ApiOptions } from "../_shared/mod";

const posts = new Set(["/api/auth/challenge", "/api/auth/verify", "/api/auth/logout", "/api/wallet/inventory",
  "/api/policies/list", "/api/policies/preview", "/api/policies/arm", "/api/policies/status", "/api/policies/revoke"]);
export class ApiHandler {
  private readonly auth: WalletSessions;
  private active = 0;
  private closed = false;
  private window = 0;
  private requests = 0;
  constructor(private readonly options: ApiOptions) { this.auth = new WalletSessions(options.origin, options.identity, options.log, options.now); }
  readonly fetch = async (request: Request): Promise<Response> => {
    let counted = false;
    try {
      if (this.closed) throw new HttpError(503, "Service stopping");
      const url = new URL(request.url), path = url.pathname;
      if (url.search !== "") throw new HttpError(400, "Query parameters unsupported");
      if (request.method === "GET" && path === "/api/health") return json(this.options.health());
      if (request.method === "GET" && path === "/api/coverage") return json({ catalog: this.options.catalog,
        keeper: this.options.keeper, guard: this.options.guard, chain: this.options.identity.chain });
      if (!posts.has(path)) throw new HttpError(404, "Endpoint not found");
      if (request.method !== "POST") throw new HttpError(405, "POST required");
      if (this.active >= 32) throw new HttpError(503, "Request capacity reached");
      if (path.startsWith("/api/auth/")) {
        const now = this.options.now();
        if (now < this.window || now - this.window >= 60000) { this.window = now; this.requests = 0; }
        if (++this.requests > 120) throw new HttpError(429, "Sign-in rate limit reached");
      }
      this.active++; counted = true;
      return await route(request, path, this.options, this.auth);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof AuthenticationError ? 401 : 500;
      const message = error instanceof HttpError || error instanceof AuthenticationError ? error.message : "Request failed; details redacted";
      this.options.log({ code: status >= 500 ? "UNAVAILABLE" : "INVALID", message, retryable: status >= 500 || status === 429,
        context: { component: "http", status: String(status) } });
      return json({ error: message }, status);
    } finally { if (counted) this.active--; }
  };
  close(): void { this.closed = true; this.auth.close(); }
}
