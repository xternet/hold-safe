import type { Connection } from "@solana/web3.js";
import { GUARD, MAINNET } from "../_0_identity/mod";
import type { GuardDeployment } from "../_5_guard/mod";

export async function verifyStartup(primary: Connection, backup: Connection, deployment: GuardDeployment): Promise<void> {
  if (new URL(primary.rpcEndpoint).origin === new URL(backup.rpcEndpoint).origin) throw new Error("Distinct RPC origins required");
  const checks = await Promise.allSettled([primary, backup].map(async connection => {
    if (await connection.getGenesisHash() !== MAINNET) throw new Error("Wrong RPC network");
    const batch = await connection.getMultipleAccountsInfoAndContext([GUARD, deployment.programData], "finalized");
    if (batch.value.length !== 2) throw new Error("Incomplete deployment evidence");
    deployment.verify(batch.value[0]!, batch.value[1]!, batch.context.slot);
  }));
  if (checks.some(result => result.status === "rejected")) throw new Error("RPC network or guard deployment verification failed");
}
