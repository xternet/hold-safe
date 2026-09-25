import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { address, lamports } from "@solana/kit";
import { Clock, LiteSVM } from "litesvm";
import { MAINNET_GENESIS, POOL, type Snapshot } from "../../_shared/mod";

function assertHash(bytes: Uint8Array, expected: string, label: string): void {
  if (createHash("sha256").update(bytes).digest("hex") !== expected) {
    throw new Error(`Snapshot digest mismatch: ${label}`);
  }
}

export function loadSnapshot(): { svm: LiteSVM; snapshot: Snapshot } {
  const file = process.env.SOLSTOCK_SNAPSHOT;
  if (file === undefined) throw new Error("Set SOLSTOCK_SNAPSHOT to the captured mainnet snapshot.json");
  const snapshot: Snapshot = JSON.parse(readFileSync(file, "utf8"));
  if (snapshot.schema !== 1 || snapshot.genesis !== MAINNET_GENESIS || snapshot.pool !== POOL ||
      !Number.isSafeInteger(snapshot.slot) || !Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.programs)) {
    throw new Error("Invalid snapshot identity/schema");
  }
  const svm = new LiteSVM();
  for (const program of snapshot.programs) {
    const path = resolve(dirname(file), program.file);
    if (dirname(path) !== resolve(dirname(file))) throw new Error("Program path escaped snapshot directory");
    const data = readFileSync(path);
    assertHash(data, program.sha256, program.address);
    svm.addProgram(address(program.address), data);
  }
  for (const account of snapshot.accounts) {
    const data = Buffer.from(account.data, "base64");
    assertHash(data, account.sha256, account.address);
    if (account.address === "SysvarC1ock11111111111111111111111111111111") {
      svm.setClock(new Clock(data.readBigUInt64LE(0), data.readBigInt64LE(8),
        data.readBigUInt64LE(16), data.readBigUInt64LE(24), data.readBigInt64LE(32)));
    } else {
      svm.setAccount({ address: address(account.address), programAddress: address(account.owner),
        lamports: lamports(BigInt(account.lamports)), executable: account.executable,
        data, space: BigInt(data.length) });
    }
  }
  return { svm, snapshot };
}
