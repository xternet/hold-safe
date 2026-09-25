import { SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
export function holdingClock(accounts: Map<string, AccountInfo<Buffer>>, slot: number, receivedAtMs: number, maxAgeMs: number) {
  const clock = accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58());
  if (clock === undefined || clock.executable || clock.owner.toBase58() !== "Sysvar1111111111111111111111111111111111111" ||
      clock.data.length !== 40) throw new Error("Invalid native clock account");
  const seconds = clock.data.readBigInt64LE(32), sourceAtMs = Number(seconds) * 1000;
  if (!Number.isSafeInteger(receivedAtMs) || !Number.isSafeInteger(sourceAtMs) || sourceAtMs > receivedAtMs ||
      receivedAtMs - sourceAtMs >= Math.min(5000, maxAgeMs)) throw new Error("Stale/future native clock");
  if (!Number.isSafeInteger(slot) || slot <= 0 || BigInt(slot) !== clock.data.readBigUInt64LE(0)) throw new Error("Incoherent native slot");
  return { seconds, sourceAtMs };
}
