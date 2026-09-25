import { mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readConnection } from "./_0_rpc/mod";
import { captureAccounts } from "./_1_accounts/mod";

const [keyFile, outputArgument] = process.argv.slice(2);
if (keyFile === undefined || outputArgument === undefined || process.argv.length !== 4) {
  throw new Error("Usage: bun run _0_capture/mod.ts KEY_FILE NEW_COLD_DIRECTORY");
}
if (statSync("/srv/cold").dev === statSync("/srv").dev) throw new Error("Cold mount unavailable");
const output = resolve(outputArgument);
if (!output.startsWith("/srv/cold/solstock-guard/")) throw new Error("Evidence must use project cold storage");
mkdirSync(output, { recursive: true, mode: 0o700 });
if (!realpathSync(output).startsWith("/srv/cold/solstock-guard/")) throw new Error("Cold path escaped");
const snapshot = await captureAccounts(readConnection(keyFile), output);
writeFileSync(`${output}/snapshot.json`, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ path: `${output}/snapshot.json`, slot: snapshot.slot,
  accounts: snapshot.accounts.length, programs: snapshot.programs.map((p) => ({ address: p.address, sha256: p.sha256 })) }));
