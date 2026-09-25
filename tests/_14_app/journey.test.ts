import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { workerFixture } from "../_9_worker/_shared/mod";
import { createAuthorization } from "../../src/_adapters/_0_solana/_1_authorize/mod";
import { createWalletIdentity } from "../../src/_adapters/_0_solana/_5_identity/mod";
import { createWalletInventory } from "../../src/_adapters/_0_solana/_6_inventory/mod";
import { createPolicyWorkflow } from "../../src/_4_authorization/mod";
import { startApi } from "../../src/_5_app/_4_api/mod";
import { installWallet } from "./_shared/mod";
import { demoPage, finishClip } from "./_shared/recording";

test("browser closes after owner authorization; foreground keeper exits and returning owner sees receipt", async () => {
  const f = await workerFixture(false), shutdown = new AbortController(), stopWorker = new AbortController();
  const log = f.options.log, worker = f.worker("browser-closed-foreground");
  const authorization = createAuthorization(f.connection, f.catalog, f.manifest,
    { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" }, f.route, log, f.now);
  const workflow = createPolicyWorkflow({ catalog: f.catalog, journal: f.journal, authorization, keeper: f.policy.keeper,
    guard: f.policy.guard, chain: f.policy.chain, now: f.now, log });
  const inventory = createWalletInventory(f.connection, f.catalog, log, f.now);
  const options = { origin: "http://127.0.0.1:1", identity: createWalletIdentity(), inventory, workflow,
    catalog: f.catalog, keeper: f.policy.keeper, guard: f.policy.guard, log, now: f.now,
    health: () => ({ worker: worker.health(), chain: { source: "local-svm", healthy: false, checkedAt: f.now(),
      reason: "Local SVM fixture; not live mainnet monitoring" }, feeds: [{ source: "controlled-market-inputs", healthy: false,
      checkedAt: f.now(), reason: "Synthetic prices drive actual risk/exit code in this test only" }] }) };
  const reservation = startApi(options, 0, shutdown.signal), url = reservation.url;
  await reservation.stop();
  const server = startApi({ ...options, origin: url.origin }, Number(url.port), shutdown.signal);
  let browser = await chromium.launch({ headless: true, args: ["--renderer-process-limit=2"] });
  let running: Promise<void> | null = null;
  try {
    const build = Bun.spawn([process.execPath, "x", "--no-install", "vite", "build"], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
    expect(code, `${out}\n${err}`).toBe(0);
    let page = await demoPage(browser);
    await page.clock.setFixedTime(f.now()); await installWallet(page, f); await page.goto(server.url.href);
    await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
    await page.getByRole("button", { name: `Manage policy ${f.digest}`, exact: true }).click();
    await page.getByRole("button", { name: "Review existing authorization", exact: true }).click();
    await page.getByLabel("I understand the operator can request an exit within these bounds.").check();
    if (process.env.SOLSTOCK_DEMO_DIR) await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Authorize in wallet", exact: true }).click();
    await page.getByText("Onchain authorization: active", { exact: true }).waitFor();
    expect(f.state()).toBe(1);
    const beforeInput = Buffer.from(f.get(f.policy.source).data).readBigUInt64LE(64);
    const beforeOutput = Buffer.from(f.get(f.policy.recipient).data).readBigUInt64LE(64);
    if (process.env.SOLSTOCK_DEMO_DIR) await page.waitForTimeout(2500);
    const approvalVideo = page.video();
    await page.context().close();
    await finishClip(approvalVideo, "01-authorize-local-svm");
    await browser.close(); expect(browser.isConnected()).toBe(false);
    // Real foreground worker with real PostgreSQL/guard/DEX execution. Only
    // market observations, native clock and provider finality are test controls.
    running = worker.run(stopWorker.signal);
    for (let i = 0; i < 10 && f.sends() === 0; i++) { await f.advance(); await Bun.sleep(1100); }
    expect(f.sends()).toBe(1); expect(f.state()).toBe(2);
    f.controls.forEach(control => { control.finality = "finalized"; });
    for (let i = 0; i < 20 && (await f.journal.readPolicy(f.digest))!.state !== "CONFIRMED"; i++) await Bun.sleep(100);
    expect((await f.journal.readPolicy(f.digest))!.state).toBe("CONFIRMED");
    const attempt = await f.journal.latest(f.digest);
    expect(attempt?.receipt?.state).toBe("confirmed");
    expect(beforeInput - Buffer.from(f.get(f.policy.source).data).readBigUInt64LE(64)).toBe(BigInt(f.policy.amountRaw));
    expect(Buffer.from(f.get(f.policy.recipient).data).readBigUInt64LE(64) - beforeOutput).toBeGreaterThanOrEqual(BigInt(f.policy.minimumOutputRaw));
    stopWorker.abort(); await running; running = null;
    browser = await chromium.launch({ headless: true, args: ["--renderer-process-limit=2"] });
    page = await demoPage(browser);
    await page.clock.setFixedTime(f.now()); await installWallet(page, f); await page.goto(server.url.href);
    await page.getByRole("button", { name: "Connect Local SVM wallet" }).click();
    await page.getByRole("button", { name: `Manage policy ${f.digest}`, exact: true }).click();
    await page.getByText("Onchain authorization: consumed", { exact: true }).waitFor();
    await page.getByText("Keeper record: CONFIRMED", { exact: true }).waitFor();
    await page.getByText(`Exit attempt: CONFIRMED · ${attempt!.signed.nativeId} · receipt confirmed`, { exact: true }).waitFor();
    expect(await page.getByRole("button", { name: "Revoke in wallet", exact: true }).isDisabled()).toBe(true);
    await page.screenshot({ path: "/srv/cold/solstock-guard/m01-20260923-01/m08-browser-closed-exit.png", fullPage: true });
    expect(f.sends()).toBe(1);
    if (process.env.SOLSTOCK_DEMO_DIR) {
      await page.getByText(`Exit attempt: CONFIRMED · ${attempt!.signed.nativeId} · receipt confirmed`, { exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(3500);
    }
    const receiptVideo = page.video();
    await page.context().close();
    await finishClip(receiptVideo, "02-return-confirmed-local-svm");
    await browser.close();
  } finally {
    stopWorker.abort(); if (running !== null) await running;
    await browser.close(); await server.stop(); await f.close();
  }
}, 60000);
