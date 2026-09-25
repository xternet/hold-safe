import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";
import { GuardDeployment, type GuardManifest } from "../_5_guard/mod";

async function document(path: string, secret: boolean): Promise<unknown> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > 16384) throw new Error("Invalid release file");
    if (secret && ((stat.mode & 0o077) !== 0 || (process.getuid === undefined || stat.uid !== process.getuid()))) throw new Error("Keeper file must be private and owned by the service user");
    const bytes = Buffer.alloc(16385);
    try {
      let count = 0;
      while (count < bytes.length) {
        const read = await file.read(bytes, count, bytes.length - count, count);
        if (read.bytesRead === 0) break;
        count += read.bytesRead;
      }
      if (count > 16384) throw new Error("Release file too large");
      return JSON.parse(bytes.subarray(0, count).toString("utf8"));
    } finally { bytes.fill(0); }
  } finally { await file.close(); }
}

export async function loadRelease(keeperFile: string, manifestFile: string) {
  const raw = await document(keeperFile, true);
  if (!Array.isArray(raw) || raw.length !== 64 || raw.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("Invalid keeper keypair");
  }
  const bytes = Uint8Array.from(raw); raw.fill(0);
  let keeper: Keypair;
  try { keeper = Keypair.fromSecretKey(Uint8Array.from(bytes)); } finally { bytes.fill(0); }
  const manifest = await document(manifestFile, false) as GuardManifest;
  const deployment = new GuardDeployment(manifest);
  return { keeper, manifest: deployment.evidence(), deployment };
}
