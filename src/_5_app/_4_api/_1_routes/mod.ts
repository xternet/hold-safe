import type { Policy } from "../../../_kernel/mod";
import type { WalletSessions } from "../_0_auth/mod";
import { bearer, body, fields, HttpError, json, text, type ApiOptions } from "../_shared/mod";

export async function route(request: Request, path: string, options: ApiOptions, auth: WalletSessions): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== options.origin) throw new HttpError(403, "Origin rejected");
  if (path === "/api/auth/challenge") {
    const input = await body(request, options.log); fields(input, ["owner"]);
    return json(auth.challenge(origin, text(input, "owner")));
  }
  if (path === "/api/auth/verify") {
    const input = await body(request, options.log); fields(input, ["id", "signatureBase64"]);
    return json(await auth.verify(origin, text(input, "id"), text(input, "signatureBase64")));
  }
  const token = bearer(request), owner = auth.owner(origin, token);
  const input = await body(request, options.log);
  if (path === "/api/auth/logout") { fields(input, []); auth.logout(origin, token); return json({ signedOut: true }); }
  let result;
  if (path === "/api/wallet/inventory") {
    fields(input, ["routeId"]); result = await options.inventory.list(owner, text(input, "routeId"));
  } else if (path === "/api/policies/list") {
    fields(input, ["after", "limit"]);
    if ((input.after !== null && typeof input.after !== "string") || typeof input.limit !== "number") throw new HttpError(400, "Invalid page");
    result = await options.workflow.list(owner, input.after, input.limit);
  } else if (path === "/api/policies/preview") {
    fields(input, ["policy"]);
    if (input.policy === null || typeof input.policy !== "object" || Array.isArray(input.policy)) throw new HttpError(400, "Policy object required");
    result = await options.workflow.preview(owner, input.policy as Policy);
  } else if (path === "/api/policies/arm") {
    fields(input, ["digest", "replaceExistingApproval"]);
    if (typeof input.replaceExistingApproval !== "boolean") throw new HttpError(400, "Explicit delegate choice required");
    result = await options.workflow.arm(owner, text(input, "digest"), { replaceExistingApproval: input.replaceExistingApproval });
  } else {
    fields(input, ["digest"]);
    result = path === "/api/policies/revoke" ? await options.workflow.revoke(owner, text(input, "digest")) :
      await options.workflow.status(owner, text(input, "digest"));
  }
  return result.ok ? json(result.value) : json({ error: result.error.message }, 409);
}
