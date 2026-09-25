import { expect, test } from "bun:test";
import { chromium } from "@playwright/test";
import { buildArm } from "../../src/_adapters/_0_solana/_shared/_3_transactions/mod";
import { authorizationFixture } from "../_8_authorization/_shared/mod";

test("wallet entry bundles and validates real native bytes in Chromium without Node globals", async () => {
  const build = await Bun.build({ entrypoints: ["src/_adapters/_0_solana/_4_wallet/mod.ts"], target: "browser", format: "esm", minify: false });
  expect(build.success).toBe(true);
  if (!build.success || build.outputs.length !== 1) throw new Error("Browser entry build failed");
  const script = await build.outputs[0]!.text(), f = await authorizationFixture();
  const envelope = buildArm(f.policy, f.digest, f.native.routeKeys,
    { blockhash: f.svm.latestBlockhash(), lastValidBlockHeight: 1150, contextSlot: f.batch.slot },
    { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000", baseFeeLamports: "5000" },
    { replaceExistingApproval: false, createRecipient: false });
  const review = { owner: f.policy.owner, policy: f.policy, catalog: f.catalog, purpose: "arm",
    replaceExistingApproval: false, maximumNetworkFeeRaw: "10000", nowMs: f.now() };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (new URL(request.url).pathname === "/wallet.js") return new Response(script, { headers: { "content-type": "text/javascript" } });
    return new Response("<!doctype html><title>Wallet entry test</title>", { headers: { "content-type": "text/html" } });
  } });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, args: ["--renderer-process-limit=2"] });
    const page = await browser.newPage(); await page.goto(server.url.href);
    await page.addScriptTag({ type: "module", content: "import * as wallet from '/wallet.js'; window.testWallet = wallet;" });
    await page.waitForFunction(() => "testWallet" in window);
    const result = await page.evaluate(async (input) => {
      const wallet = (window as unknown as { testWallet: any }).testWallet;
      const transaction = await wallet.validateOwnerTransaction(input.envelope, input.review);
      let observed = -1;
      const stop = wallet.watchWallets((items: unknown[]) => { observed = items.length; }); stop();
      return { bytes: transaction.serialize().length, observed,
        nodeBuffer: typeof (globalThis as unknown as { Buffer?: unknown }).Buffer };
    }, { envelope, review });
    expect(result.bytes).toBe(Buffer.from(envelope.bytesBase64, "base64").length);
    expect(result.observed).toBe(0); expect(result.nodeBuffer).toBe("undefined");
  } finally { if (browser !== undefined) await browser.close(); await server.stop(true); await f.stop(); }
}, 30000);
