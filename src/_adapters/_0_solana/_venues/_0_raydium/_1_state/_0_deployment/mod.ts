import { createHash } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { DEX, LOADER } from "../../../../_shared/mod";

export class DeploymentCheck {
  private verified: { version: string; address: PublicKey } | undefined;
  constructor(private readonly connection: Connection, private readonly dex = DEX) {}
  async verify(expected: string, minContextSlot: number): Promise<void> {
    if (this.verified === undefined) {
      const program = await this.connection.getAccountInfoAndContext(this.dex, { commitment: "confirmed", minContextSlot });
      if (program.value === null || !program.value.executable || !program.value.owner.equals(LOADER) ||
          program.value.data.length !== 36 || program.value.data.readUInt32LE(0) !== 2) throw new Error("Unsupported CLMM loader/deployment");
      const address = new PublicKey(program.value.data.subarray(4, 36));
      const result = await this.connection.getAccountInfoAndContext(address, { commitment: "confirmed", minContextSlot: program.context.slot });
      if (result.value === null || !result.value.owner.equals(LOADER) || result.value.data.readUInt32LE(0) !== 3) throw new Error("Invalid CLMM ProgramData");
      const bytes = result.value.data;
      const version = `slot:${bytes.readBigUInt64LE(4)}:sha256:${createHash("sha256").update(bytes.subarray(45)).digest("hex")}`;
      if (version !== expected) throw new Error("CLMM binary differs from authorized deployment");
      this.verified = { version, address };
      return;
    }
    if (this.verified.version !== expected) throw new Error("Policy deployment version mismatch");
    const result = await this.connection.getAccountInfoAndContext(this.verified.address,
      { commitment: "confirmed", minContextSlot, dataSlice: { offset: 0, length: 45 } });
    if (result.value === null || !result.value.owner.equals(LOADER) || result.value.data.length !== 45 || result.value.data.readUInt32LE(0) !== 3) throw new Error("Invalid CLMM deployment header");
    const slot = result.value.data.readBigUInt64LE(4).toString();
    if (expected.split(":")[1] !== slot) throw new Error("CLMM upgraded; policy unavailable pending reauthorization");
  }
}
