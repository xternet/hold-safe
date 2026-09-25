import { expect, test } from "bun:test";
import { browserModuleAllowed } from "../../vite.config";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("browser bundle boundary rejects server, secret, test and foreign adapter modules", () => {
  for (const path of ["src/_5_app/mod.tsx", "src/_kernel/_3_policy/mod.ts", "src/_adapters/_0_solana/_4_wallet/mod.ts",
    "src/_adapters/_0_solana/_shared/_2_codec/_0_instructions/mod.ts", "node_modules/react/index.js"]) expect(browserModuleAllowed(path), path).toBe(true);
  for (const path of ["src/root.ts", "src/_5_app/_4_api/_0_auth/mod.ts", "src/_0_setup/mod.ts", "src/_shared/_0_store/mod.ts",
    "src/_adapters/_0_solana/_shared/_9_release/mod.ts", "src/_adapters/_2_alpaca/mod.ts", "tests/_14_app/_shared/mod.ts",
    "secrets/keeper.json", "../shared/config/keys.env", ".env", "src/_kernel/_3_policy/mod.test.ts"]) expect(browserModuleAllowed(path), path).toBe(false);
});
test("production build records actual included modules and enforces the browser boundary", async () => {
  const build = Bun.spawn([process.execPath, "x", "--no-install", "vite", "build"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
  expect(code, `${out}\n${err}`).toBe(0);
  const audit = await Bun.file("dist/browser-modules.json").json();
  expect(audit.modules).toContain("src/_5_app/mod.tsx");
  expect(audit.modules.some((path: string) => path.startsWith("src/_adapters/_0_solana/_4_wallet/"))).toBe(true);
  for (const path of audit.modules) expect(browserModuleAllowed(path), path).toBe(true);
}, 30000);
test("real build fails when browser entry imports an API module, including unused exports", async () => {
  const root = process.cwd(), temporary = await mkdtemp(join(tmpdir(), "solstock-browser-boundary-"));
  try {
    await mkdir(join(temporary, "src/_5_app/_4_api"), { recursive: true });
    await writeFile(join(temporary, "index.html"), '<script type="module" src="/src/_5_app/probe.ts"></script>');
    await writeFile(join(temporary, "src/_5_app/probe.ts"), 'import "./_4_api/leak"; document.body.textContent = "probe";');
    await writeFile(join(temporary, "src/_5_app/_4_api/leak.ts"), 'export const secret = "TEST_CANARY_NOT_A_REAL_SECRET";');
    const build = Bun.spawn([process.execPath, join(root, "node_modules/vite/bin/vite.js"), "build", "--config", join(root, "vite.config.ts")],
      { cwd: temporary, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(build.stdout).text(), new Response(build.stderr).text(), build.exited]);
    expect(code).not.toBe(0); expect(`${out}\n${err}`).toContain("Forbidden browser dependency: src/_5_app/_4_api/leak.ts");
  } finally { await rm(temporary, { recursive: true, force: true }); }
}, 30000);
