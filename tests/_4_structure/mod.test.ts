import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const excluded = new Set(["node_modules", "target", ".tools", ".git", ".autonomy", "data", "generated"]);
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx|rs)$/.test(entry.name) ? [path] : [];
  });
}
function violation(owner: string, target: string): boolean {
  const from = owner.split("/"), to = target.split("/");
  if (from[0] === "_kernel" && to[0] !== "_kernel") return true;
  if (from[0] === "_shared" && !["_shared", "_kernel"].includes(to[0]!)) return true;
  if (/^_[0-5]_/.test(from[0]!) && /^_[0-5]_/.test(to[0]!) && from[0] !== to[0]) return true;
  if (/^_[0-5]_/.test(from[0]!) && to[0] === "_adapters") {
    return !(from[0] === "_5_app" && target === "_adapters/_0_solana/_4_wallet/mod.ts");
  }
  return from[0] === "_adapters" && to[0] === "_adapters" && from[1] !== to[1] && from.length > 2;
}

test("dependency boundary checker rejects cross-stage and native kernel imports", () => {
  expect(violation("_2_risk/mod.ts", "_3_execution/mod.ts")).toBe(true);
  expect(violation("_kernel/_0_types/mod.ts", "_adapters/_0_solana/mod.ts")).toBe(true);
  expect(violation("_adapters/_0_solana/mod.ts", "_adapters/_1_evm/mod.ts")).toBe(true);
  expect(violation("_2_risk/mod.ts", "_kernel/mod.ts")).toBe(false);
  expect(violation("_5_app/mod.tsx", "_adapters/_0_solana/_4_wallet/mod.ts")).toBe(false);
  expect(violation("_5_app/mod.tsx", "_adapters/_0_solana/_4_wallet/_1_connection/mod.ts")).toBe(true);
});

test("source files obey line budgets, ownership and acyclic imports", () => {
  const paths = sources(root);
  const graph = new Map<string, string[]>();
  for (const path of paths) {
    const name = relative(root, path).replace(/^src\//, "");
    const body = readFileSync(path, "utf8");
    const count = body.trimEnd().split("\n").length;
    expect(count, name).toBeLessThanOrEqual(200);
    if (/(^|\/)root\.(ts|tsx)$/.test(name)) expect(name).toBe("root.ts");
    if (/(^|\/)(root|mod)\.(ts|tsx)$/.test(name) && readdirSync(dirname(path), { withFileTypes: true }).some((e) => e.isDirectory() && e.name.startsWith("_"))) {
      expect(count, name).toBeLessThanOrEqual(50);
    }
    if (path.endsWith(".rs")) continue;
    const file = ts.createSourceFile(path, body, ts.ScriptTarget.Latest, true);
    function inspect(node: ts.Node): void {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        throw new Error(`Dynamic module loading is not an adapter boundary: ${name}`);
      }
      if (name.startsWith("_kernel/") && !name.endsWith(".test.ts") && ts.isIdentifier(node) &&
          ["fetch", "WebSocket", "Bun", "process"].includes(node.text)) {
        throw new Error(`Kernel runtime capability: ${name} -> ${node.text}`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(file);
    const edges: string[] = [];
    for (const node of file.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (node.moduleSpecifier === undefined || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith(".")) {
        if (name.startsWith("_kernel/") && !name.endsWith(".test.ts")) throw new Error(`Kernel external dependency: ${name} -> ${specifier}`);
        continue;
      }
      const base = resolve(dirname(path), specifier);
      if (specifier.endsWith(".css")) {
        expect(name.startsWith("_5_app/"), "Styles belong to the browser app").toBe(true);
        expect(existsSync(base), "Missing imported style asset").toBe(true); continue;
      }
      const found = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => paths.includes(candidate));
      if (found === undefined) throw new Error(`Unresolved local import: ${name} -> ${specifier}`);
      const target = relative(root, found).replace(/^src\//, "");
      expect(violation(name, target), `${name} -> ${target}`).toBe(false);
      edges.push(found);
    }
    graph.set(path, edges);
  }
  const done = new Set<string>(), active = new Set<string>();
  function visit(path: string): void {
    if (active.has(path)) throw new Error(`Import cycle: ${relative(root, path)}`);
    if (done.has(path)) return;
    active.add(path);
    const edges = graph.get(path);
    if (edges !== undefined) for (const edge of edges) visit(edge);
    active.delete(path); done.add(path);
  }
  for (const path of graph.keys()) visit(path);
});

test("repository keeps shipped code in src and integration checks in tests",()=>{
 expect(existsSync(resolve(root,"src/root.ts"))).toBe(true);
 expect(existsSync(resolve(root,"tests"))).toBe(true);
 for(const name of ["root.ts","_0_setup","_5_app","_adapters","_kernel","_shared","_9_tests"])expect(existsSync(resolve(root,name)),name).toBe(false);
});
