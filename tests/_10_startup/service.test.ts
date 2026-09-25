import { expect, test } from "bun:test";
import { createAdapters } from "../../src/_adapters/mod";
import { composeWorker } from "../../src/root";
import { journalFixture } from "../_5_storage/_shared/mod";
import { startupFixture } from "./_shared/mod";

test("registry and root compose a foreground worker with real journal and native ports", async () => {
  const f = await startupFixture(), db = await journalFixture();
  let requests = 0;
  const calendar = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    expect(request.headers.get("APCA-API-KEY-ID")).toBe("local-key");
    expect(request.headers.get("APCA-API-SECRET-KEY")).toBe("local-secret");
    requests++;
    return Response.json([]);
  } });
  try {
    const registry = await createAdapters({ ...f.options, alpaca: { key: "local-key", secret: "local-secret" }, calendarOrigin: calendar.url.origin });
    try {
      await registry.start();
      expect(requests).toBe(1);
      expect([...registry.feeds.keys()]).toEqual(["alpaca-sip", "kraken-usd"]);
      const { journal } = db.open(), worker = composeWorker(registry, journal, f.catalog, f.options.log, f.now);
      const stop = new AbortController(), running = worker.run(stop.signal);
      try {
        const deadline = Date.now() + 2000;
        while (!worker.health().healthy && Date.now() < deadline) await Bun.sleep(10);
        expect(worker.health().healthy).toBe(true);
        expect(worker.health().active).toBe(0);
      } finally { stop.abort(); await running; }
      expect(worker.health().healthy).toBe(false);
      expect(f.sends()).toBe(0);
    } finally { await registry.stop(); }
  } finally { await calendar.stop(true); await db.close(); await f.close(); }
});

test("CLI fails configuration explicitly without printing inherited secret values", async () => {
  const child = Bun.spawn([process.execPath, "src/root.ts"], { cwd: process.cwd(),
    env: { SOLSTOCK_RPC_HTTP: "https://example.invalid/key-secret-do-not-log", API_ALPACA_SECRET: "alpaca-secret-do-not-log" },
    stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(exit).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain("SOLSTOCK_BACKUP_RPC_HTTP");
  expect(stderr).not.toContain("key-secret-do-not-log");
  expect(stderr).not.toContain("alpaca-secret-do-not-log");
});
