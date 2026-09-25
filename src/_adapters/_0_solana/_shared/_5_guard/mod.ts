import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { copyValue } from "../../../../_kernel/mod";
import { GUARD, GUARD_VERSION, LOADER } from "../_0_identity/mod";

export type GuardManifest = { version: string; programData: string; deploymentSlot: string;
  authority: string | null; binaryLength: number; binaryHash: string };
export class GuardDeployment {
  private readonly expected: GuardManifest;
  readonly programData: PublicKey;
  constructor(manifest: GuardManifest, guard = GUARD) {
    this.expected = copyValue(manifest); this.programData = new PublicKey(manifest.programData);
    const derived = PublicKey.findProgramAddressSync([guard.toBuffer()], LOADER)[0];
    if (manifest.version !== GUARD_VERSION || !this.programData.equals(derived) || !/^[1-9][0-9]*$/.test(manifest.deploymentSlot) ||
      !Number.isSafeInteger(manifest.binaryLength) || manifest.binaryLength <= 0 || manifest.binaryLength > 10_000_000 ||
      !/^[a-f0-9]{64}$/.test(manifest.binaryHash)) throw new Error("Invalid guard release manifest");
    if (manifest.authority !== null && new PublicKey(manifest.authority).toBase58() !== manifest.authority) throw new Error("Invalid guard upgrade authority");
  }
  verify(program: AccountInfo<Buffer> | null, data: AccountInfo<Buffer> | null, slot: number): void {
    if (program === null || data === null || !program.owner.equals(LOADER) || !program.executable || program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2 || !new PublicKey(program.data.subarray(4)).equals(this.programData) ||
      !data.owner.equals(LOADER) || data.executable || data.data.length < 45 + this.expected.binaryLength || data.data.readUInt32LE(0) !== 3) {
      throw new Error("Guard deployment missing or loader identity changed");
    }
    const bytes = data.data, deployed = bytes.readBigUInt64LE(4);
    if (!Number.isSafeInteger(slot) || deployed > BigInt(slot) || deployed.toString() !== this.expected.deploymentSlot) throw new Error("Guard deployment slot changed");
    if (bytes[12] !== 0 && bytes[12] !== 1) throw new Error("Invalid guard authority metadata");
    const authority = bytes[12] === 0 ? null : new PublicKey(bytes.subarray(13, 45)).toBase58();
    if (authority !== this.expected.authority) throw new Error("Guard upgrade authority changed");
    const end = 45 + this.expected.binaryLength;
    if (bytes.subarray(end).some(value => value !== 0) || createHash("sha256").update(bytes.subarray(45, end)).digest("hex") !== this.expected.binaryHash) {
      throw new Error("Guard binary differs from pinned release");
    }
  }
  evidence(): GuardManifest { return copyValue(this.expected); }
}
