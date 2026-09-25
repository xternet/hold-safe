import { expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { createWalletIdentity } from "../../src/_adapters/_0_solana/_5_identity/mod";
import { WalletSessions } from "../../src/_5_app/_4_api/_0_auth/mod";

function fixture() {
  const key = generateKeyPairSync("ed25519"), other = generateKeyPairSync("ed25519");
  const owner = new PublicKey(key.publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toBase58();
  const faults: unknown[] = []; let now = Date.parse("2026-09-24T12:00:00Z");
  const log = (fault: unknown) => faults.push(fault), identity = createWalletIdentity();
  const auth = new WalletSessions("https://guard.example", identity, log, () => now);
  return { auth, identity, owner, faults, now: () => now, advance: (ms: number) => { now += ms; },
    signature: (message: string, foreign = false) => sign(null, Buffer.from(message, "utf8"), foreign ? other.privateKey : key.privateKey).toString("base64") };
}

test("actual wallet signature binds the challenge and creates an expiring revocable session", async () => {
  const f = fixture(), challenge = f.auth.challenge("https://guard.example", f.owner);
  expect(challenge.message).toContain("guard.example");
  expect(challenge.message).toContain(f.owner);
  expect(challenge.message).toContain(f.identity.chain.reference);
  expect(challenge.message).toContain(challenge.id);
  expect(challenge.message).toContain("does not authorize transactions");
  const session = await f.auth.verify("https://guard.example", challenge.id, f.signature(challenge.message));
  expect(f.auth.owner("https://guard.example", session.token)).toBe(f.owner);
  expect(session.expiresAtMs).toBe(f.now() + 1800000);
  f.auth.logout("https://guard.example", session.token);
  expect(() => f.auth.owner("https://guard.example", session.token)).toThrow("Authentication rejected");
  expect(JSON.stringify(f.faults)).not.toContain(session.token);
});

test("wrong owner, changed message, expired challenge and origin mismatch cannot authenticate", async () => {
  const f = fixture();
  for (const tamper of ["wrong-key", "changed-origin", "changed-chain", "expired"]) {
    const c = f.auth.challenge("https://guard.example", f.owner);
    let message = c.message;
    if (tamper === "changed-origin") message = message.replaceAll("guard.example", "evil.example");
    if (tamper === "changed-chain") message = message.replace(f.identity.chain.reference, "another-network");
    const signature = f.signature(message, tamper === "wrong-key");
    if (tamper === "expired") f.advance(300000);
    await expect(f.auth.verify("https://guard.example", c.id, signature)).rejects.toThrow("Authentication rejected");
  }
  expect(() => f.auth.challenge("https://evil.example", f.owner)).toThrow("Authentication rejected");
  expect(() => f.auth.challenge("https://guard.example", "bad-owner")).toThrow("Authentication rejected");
  const c = f.auth.challenge("https://guard.example", f.owner);
  await expect(f.auth.verify("https://evil.example", c.id, f.signature(c.message))).rejects.toThrow("Authentication rejected");
});

test("concurrent replay issues at most one session and session lifetime cannot survive clock rollback", async () => {
  const f = fixture(), c = f.auth.challenge("https://guard.example", f.owner), signature = f.signature(c.message);
  const attempts = await Promise.allSettled([f.auth.verify("https://guard.example", c.id, signature),
    f.auth.verify("https://guard.example", c.id, signature)]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const session = attempts.find(result => result.status === "fulfilled");
  if (session === undefined || session.status !== "fulfilled") throw new Error("Expected one actual signature acceptance");
  f.advance(-1);
  expect(() => f.auth.owner("https://guard.example", session.value.token)).toThrow("Authentication rejected");
  f.advance(1);
  const next = f.auth.challenge("https://guard.example", f.owner);
  const second = await f.auth.verify("https://guard.example", next.id, f.signature(next.message));
  f.advance(1800000);
  expect(() => f.auth.owner("https://guard.example", second.token)).toThrow("Authentication rejected");
  const restarted = new WalletSessions("https://guard.example", f.identity, e => f.faults.push(e), f.now);
  expect(() => restarted.owner("https://guard.example", second.token)).toThrow("Authentication rejected");
  expect(JSON.stringify(f.faults)).not.toContain(signature);
  expect(JSON.stringify(f.faults)).not.toContain(c.id);
});

test("challenge capacity is bounded and expiry releases it", () => {
  const f = fixture();
  for (let i = 0; i < 1024; i++) f.auth.challenge("https://guard.example", f.owner);
  expect(() => f.auth.challenge("https://guard.example", f.owner)).toThrow("Authentication rejected");
  f.advance(300000);
  expect(f.auth.challenge("https://guard.example", f.owner).expiresAtMs).toBe(f.now() + 300000);
});

test("malformed signatures are consumed once and closing sessions prevents later use", async () => {
  const f = fixture();
  for (const signature of ["", "private-material", "A".repeat(88), Buffer.alloc(64).toString("base64")]) {
    const c = f.auth.challenge("https://guard.example", f.owner);
    await expect(f.auth.verify("https://guard.example", c.id, signature)).rejects.toThrow("Authentication rejected");
    await expect(f.auth.verify("https://guard.example", c.id, f.signature(c.message))).rejects.toThrow("Authentication rejected");
  }
  f.auth.close();
  expect(() => f.auth.challenge("https://guard.example", f.owner)).toThrow("Authentication rejected");
  expect(JSON.stringify(f.faults)).not.toContain("private-material");
});
