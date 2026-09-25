import { expect, test } from "bun:test";
import { createPrivateKey, sign } from "node:crypto";
import { startApi } from "../../src/_5_app/_4_api/mod";
import { createWalletIdentity } from "../../src/_adapters/_0_solana/_5_identity/mod";
import { workflowFixture } from "../_11_policy_workflow/_shared/mod";

test("HTTP wallet login grants only its owner's real policy operations", async () => {
  const f = await workflowFixture(), origin = "https://guard.example";
  const shutdown = new AbortController();
  const server = startApi({ origin, identity: createWalletIdentity(), workflow: f.workflow, inventory: f.inventory, catalog: f.catalog,
    keeper: f.policy.keeper, guard: f.policy.guard, health: () => ({ healthy: false }), log: e => f.faults.push(e), now: f.now }, 0, shutdown.signal);
  async function post(path: string, body: unknown, token?: string, source = origin) {
    return fetch(new URL(path, server.url), { method: "POST", headers: { origin: source, "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
  }
  try {
    expect((await post("/api/policies/preview", { policy: f.policy })).status).toBe(401);
    expect((await post("/api/wallet/inventory", { routeId: f.policy.routeId })).status).toBe(401);
    const challenged = await post("/api/auth/challenge", { owner: f.policy.owner }); expect(challenged.status).toBe(200);
    const c = await challenged.json();
    // RFC 8410 PKCS#8 prefix wraps the test wallet's Ed25519 seed; no production key is loaded.
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(f.a.owner.secretKey.subarray(0, 32))]), format: "der", type: "pkcs8" });
    const signatureBase64 = sign(null, Buffer.from(c.message), key).toString("base64");
    const login = await post("/api/auth/verify", { id: c.id, signatureBase64 }); expect(login.status).toBe(200);
    const { token } = await login.json();
    const inventory = await post("/api/wallet/inventory", { routeId: f.policy.routeId }, token);
    expect(inventory.status).toBe(200);
    expect((await inventory.json()).holdings[0].account).toBe(f.policy.source);
    expect((await post("/api/wallet/inventory", { routeId: f.policy.routeId, owner: f.policy.keeper }, token)).status).toBe(400);
    expect((await post("/api/auth/verify", { id: c.id, signatureBase64 })).status).toBe(401);
    expect((await post("/api/policies/preview", { policy: f.policy }, token, "https://evil.example")).status).toBe(403);
    expect((await post("/api/policies/preview", { policy: { ...f.policy, owner: f.policy.keeper } }, token)).status).toBe(409);
    const preview = await post("/api/policies/preview", { policy: f.policy }, token); expect(preview.status).toBe(200);
    expect((await preview.json()).digest).toBe(f.digest);
    const listing = await post("/api/policies/list", { after: null, limit: 20 }, token);
    expect(listing.status).toBe(200); expect((await listing.json()).map((row: { digest: string }) => row.digest)).toEqual([f.digest]);
    expect((await post("/api/policies/list", { after: null, limit: 20, owner: f.policy.keeper }, token)).status).toBe(400);
    const arm = await post("/api/policies/arm", { digest: f.digest, replaceExistingApproval: false }, token);
    expect(arm.status).toBe(200); expect((await arm.json()).purpose).toBe("arm");
    expect((await f.journal.readPolicy(f.digest))?.state).toBe("ARMING");
    const state = await post("/api/policies/status", { digest: f.digest }, token); expect(state.status).toBe(200);
    expect((await state.json()).authorization.value.state).toBe("absent");
    expect((await post("/api/auth/logout", {}, token)).status).toBe(200);
    expect((await post("/api/policies/status", { digest: f.digest }, token)).status).toBe(401);
    const health = await fetch(new URL("/api/health", server.url));
    expect(health.headers.get("cache-control")).toBe("no-store");
    expect(await health.json()).toEqual({ healthy: false });
    expect((await post("/api/auth/challenge", { owner: f.policy.owner, privateKey: "not-accepted" })).status).toBe(400);
    expect((await post("/api/auth/challenge", { owner: "x".repeat(17000) })).status).toBe(413);
    expect((await fetch(new URL("/api/auth/challenge", server.url))).status).toBe(405);
    expect((await fetch(new URL("/api/health?token=not-accepted", server.url))).status).toBe(400);
    let rateLimited = false;
    for (let i = 0; i < 121; i++) {
      const response = await post("/api/auth/challenge", { owner: f.policy.owner });
      await response.arrayBuffer();
      if (response.status === 429) { rateLimited = true; break; }
    }
    expect(rateLimited).toBe(true);
    shutdown.abort();
    expect((await fetch(new URL("/api/health", server.url))).status).toBe(503);
    expect(JSON.stringify(f.faults)).not.toContain(token);
    expect(JSON.stringify(f.faults)).not.toContain(signatureBase64);
  } finally { await server.stop(); await f.close(); }
});
