import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { relative, isAbsolute } from "node:path";

const nativeBrowserFiles = new Set([
  "src/_adapters/_0_solana/_shared/_0_identity/mod.ts",
  "src/_adapters/_0_solana/_shared/_2_codec/_0_instructions/mod.ts",
  "src/_adapters/_0_solana/_shared/_2_codec/_shared/mod.ts",
  "src/_adapters/_0_solana/_shared/_3_transactions/_1_envelope/mod.ts",
  "src/_adapters/_0_solana/_shared/_3_transactions/_shared/mod.ts",
]);
export function browserModuleAllowed(path: string): boolean {
  if (path.includes("..") || /\.(test|spec)\.[jt]sx?$/.test(path)) return false;
  if (path.startsWith("\0vite/") || path === "\0rolldown/runtime.js" || path === "__vite-browser-external") return true;
  if (path.startsWith("node_modules/")) return true;
  if (path === "index.html") return true;
  if (path.startsWith("src/_5_app/") && !path.startsWith("src/_5_app/_4_api/")) return true;
  return path.startsWith("src/_kernel/") || path.startsWith("src/_adapters/_0_solana/_4_wallet/") || nativeBrowserFiles.has(path);
}
function modulePath(id: string): string {
  const file = id.split("?")[0]!;
  return isAbsolute(file) ? relative(process.cwd(), file).replaceAll("\\", "/") : file;
}
export default defineConfig({ plugins: [react(), {
  name: "holdsafe-browser-boundary",
  moduleParsed(info) {
    const path = modulePath(info.id);
    if (!browserModuleAllowed(path)) this.error(`Forbidden browser dependency: ${path}; importers: ${info.importers.join(", ")}`);
  },
  generateBundle(_options, bundle) {
    const modules = new Set<string>();
    for (const file of Object.values(bundle)) if (file.type === "chunk") for (const id of Object.keys(file.modules)) {
      const path = modulePath(id);
      if (!browserModuleAllowed(path)) this.error(`Forbidden bundled dependency: ${path}`);
      modules.add(path);
    }
    this.emitFile({ type: "asset", fileName: "browser-modules.json", source: JSON.stringify({ modules: [...modules].sort() }, null, 2) });
  },
}], build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: { host: "127.0.0.1", strictPort: true } });
