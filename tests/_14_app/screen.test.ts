import type { Fault, PolicyPreview } from "../../src/_kernel/mod";
import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { startApi } from "../../src/_5_app/_4_api/mod";
import { createWalletIdentity } from "../../src/_adapters/_0_solana/_5_identity/mod";
import { workflowFixture } from "../_11_policy_workflow/_shared/mod";
import { installWallet } from "./_shared/mod";
import { policyAddress } from "../../src/_adapters/_0_solana/_shared/_2_codec/mod";

test("built React screen shows real coverage and explicit unavailable fixture health", async () => {
  const f = await workflowFixture(), signal = new AbortController();
  const options = { origin: "https://guard.example", identity: createWalletIdentity(), workflow: f.workflow, inventory: f.inventory, catalog: f.catalog,
    keeper: f.policy.keeper, guard: f.policy.guard, health: () => ({
      worker: { healthy: false, checkedAt: f.now(), active: 0 },
      chain: { source: "solana", healthy: false, checkedAt: f.now(), reason: "Local UI fixture: no live chain watch" },
      feeds: [{ source: "alpaca-sip", healthy: false, checkedAt: f.now(), reason: "Local UI fixture: no live SIP subscription" }],
    }), log: (e: Fault) => f.faults.push(e), now: f.now };
  const browser = await chromium.launch({ headless: true, args: ["--renderer-process-limit=2"] });
  const before = startApi(options, 0, signal.signal);
  try {
    const baseline = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await baseline.goto(before.url.href);
    if (!await Bun.file("/srv/cold/solstock-guard/m01-20260923-01/m08-screen-before.png").exists()) {
      await baseline.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-screen-before.png", fullPage: true });
    }
    // Close the baseline context's keep-alive sockets before rebinding its port.
    await baseline.close();
    await before.stop();
    const build = Bun.spawn([process.execPath, "x", "--no-install", "vite", "build"], { stdout: "pipe", stderr: "pipe" });
    const [out, err, exit] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
    expect(exit, `${out}\n${err}`).toBe(0);
    const server = startApi({ ...options, origin: before.url.origin }, Number(before.url.port), signal.signal);
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.clock.setFixedTime(f.now());
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const requests: string[] = [];
      page.on("requestfailed", request => requests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
      page.on("response", response => { if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`); });
      await page.goto(server.url.href);
      await page.getByRole("heading", { name: "Your stocks. Your exit rules." }).waitFor();
      await page.getByText("AAPLx → USDC", { exact: true }).waitFor({ timeout: 10000 }).catch(async cause => {
        throw new Error(`${String(cause)}\n${await page.locator("body").innerText()}\n${requests.join("\n")}\n${errors.join("\n")}`);
      });
      expect(await page.getByText("Monitoring unavailable", { exact: true }).count()).toBe(1);
      expect(await page.getByText("No compatible wallet detected", { exact: true }).count()).toBe(1);
      expect(await page.locator("body").innerText()).toContain("operator chooses when");
      expect(errors).toEqual([]);
      await page.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-screen-after.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-screen-mobile.png", fullPage: true });
      expect((await fetch(new URL("/.env", server.url))).status).toBe(404);
      expect((await fetch(new URL("/root.ts", server.url))).status).toBe(404);
      expect((await fetch(new URL("/secrets/guard-keypair.json", server.url))).status).toBe(404);
      expect((await f.workflow.preview(f.policy.owner, f.policy)).ok).toBe(true);
      const wallet = await installWallet(page, f);
      await page.reload();
      await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
      await page.getByRole("heading", { name: "Authorization history" }).waitFor({ timeout: 10000 }).catch(async cause => {
        throw new Error(`${String(cause)}\n${await page.locator("body").innerText()}\n${errors.join("\n")}`);
      });
      await page.getByText(f.digest, { exact: true }).waitFor();
      expect(await page.getByText("DRAFT", { exact: true }).count()).toBe(1);
      await page.getByLabel("Portion of balance").selectOption("10");
      await page.getByLabel("Minimum proceeds (USDC)").fill("0.01");
      const previewed = page.waitForResponse(response => response.url().endsWith("/api/policies/preview"));
      await page.getByRole("button", { name: "Review policy", exact: true }).click();
      const reviewed: PolicyPreview = await (await previewed).json();
      await page.getByRole("heading", { name: "Review your authorization" }).waitFor();
      await page.getByLabel("I understand the operator can request an exit within these bounds.").check();
      wallet.rejectOnce();
      await page.getByRole("button", { name: "Authorize in wallet", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "User rejected the local test wallet prompt" }).waitFor();
      await page.getByText("Onchain authorization: absent", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Retry same authorization", exact: true }).click();
      await page.getByText("Onchain authorization: active", { exact: true }).waitFor();
      expect(Buffer.from(f.get(policyAddress(reviewed.policy).toBase58()).data)[9]).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-armed-screen.png", fullPage: true });
      await page.reload();
      await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
      await page.getByRole("button", { name: `Manage policy ${reviewed.digest}`, exact: true }).click();
      await page.getByRole("heading", { name: "Policy details", exact: true }).waitFor();
      await page.getByText("Onchain authorization: active", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Revoke in wallet", exact: true }).click();
      await page.getByText("Onchain authorization: revoked", { exact: true }).waitFor();
      expect(Buffer.from(f.get(policyAddress(reviewed.policy).toBase58()).data)[9]).toBe(3);
      await page.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-returned-policy.png", fullPage: true });
      await page.getByRole("button", { name: "Disconnect", exact: true }).click();
      expect(await page.getByRole("heading", { name: "Authorization history" }).count()).toBe(0);
      const verified = page.waitForResponse(response => response.url().endsWith("/api/auth/verify"));
      await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
      const secondSession = await (await verified).json();
      await page.getByRole("heading", { name: "Authorization history" }).waitFor();
      const revoked = page.waitForResponse(response => response.url().endsWith("/api/auth/logout"));
      await page.evaluate(() => { window.dispatchEvent(new Event("fixture-account-change")); });
      await page.getByText("Wallet account changed. Sign in again.", { exact: true }).waitFor();
      expect((await revoked).status()).toBe(200);
      expect((await fetch(new URL("/api/policies/list", server.url), { method: "POST", headers: {
        origin: server.url.origin, "content-type": "application/json", authorization: `Bearer ${secondSession.token}`,
      }, body: JSON.stringify({ after: null, limit: 50 }) })).status).toBe(401);
      expect(await page.getByRole("heading", { name: "Authorization history" }).count()).toBe(0);
      expect(errors).toEqual([]);
      for (let i = 0; i < 21; i++) await f.journal.putPolicy({ ...f.policy, orderId: i.toString(16).padStart(64, "0") });
      await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
      await page.getByRole("button", { name: "Next policies", exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Manage policy "]').length === 20);
      await page.getByRole("button", { name: "Next policies", exact: true }).click();
      await page.getByText("Page 2", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Manage policy "]').length === 3);
      expect(await page.getByRole("button", { name: "Next policies", exact: true }).isDisabled()).toBe(true);
      await page.getByRole("button", { name: "Previous policies", exact: true }).click();
      await page.getByText("Page 1", { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Manage policy "]').length === 20);
    } finally { await server.stop(); }
  } finally { await before.stop(); await browser.close(); await f.close(); }
}, 60000);
