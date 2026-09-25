import { expect, test } from "bun:test";
import { writeFile, chmod } from "node:fs/promises";
import { startupFixture } from "./_shared/mod";
import { VersionedTransaction } from "@solana/web3.js";
import { loadRelease } from "../../src/_adapters/_0_solana/_shared/_9_release/mod";
import { createSolana } from "../../src/_adapters/_0_solana/mod";


test("native composition verifies real guard state and exposes usable authorization and holdings", async () => {
  const f = await startupFixture();
  try {
    const native = await createSolana(f.options).catch(error => { throw new Error(JSON.stringify(f.faults), { cause: error }); });
    expect(native.keeper).toBe(f.policy.keeper);
    expect(native.guard).toBe(f.policy.guard);
    const auth = await native.authorization.read(f.policy);
    expect(auth.ok).toBe(true);
    if (!auth.ok) throw new Error("Expected native authorization");
    expect(auth.value.state).toBe("active");
    const holding = await native.chain.readHolding(f.policy);
    expect(holding.ok).toBe(true);
    const release = await loadRelease(f.options.keeperFile, f.options.guardManifest);
    const transaction = VersionedTransaction.deserialize(Buffer.from(f.signed.bytesBase64, "base64"));
    transaction.sign([release.keeper]);
    const publicKey = await crypto.subtle.importKey("raw", Uint8Array.from(release.keeper.publicKey.toBytes()), { name: "Ed25519" }, false, ["verify"]);
    expect(await crypto.subtle.verify("Ed25519", publicKey, Uint8Array.from(transaction.signatures[0]!), Uint8Array.from(transaction.message.serialize()))).toBe(true);
    expect(f.sends()).toBe(0);
  } finally { await f.close(); }
});

test("native startup rejects wrong backup network and changed pinned code", async () => {
  const f = await startupFixture();
  try {
    f.controls[1]!.genesis = "wrong-network";
    await expect(createSolana(f.options)).rejects.toThrow("Solana startup failed");
    f.controls[1]!.genesis = f.policy.chain.reference;
    await writeFile(f.options.guardManifest, JSON.stringify({ ...f.manifest, binaryHash: "0".repeat(64) }));
    await expect(createSolana(f.options)).rejects.toThrow("Solana startup failed");
    expect(f.sends()).toBe(0);
  } finally { await f.close(); }
});

test("native startup rejects exposed or malformed keeper files without logging their contents", async () => {
  const f = await startupFixture();
  try {
    await chmod(f.options.keeperFile, 0o644);
    await expect(createSolana(f.options)).rejects.toThrow("Solana startup failed");
    await chmod(f.options.keeperFile, 0o600);
    await writeFile(f.options.keeperFile, "private-corrupt-material");
    await expect(createSolana(f.options)).rejects.toThrow("Solana startup failed");
    expect(JSON.stringify(f.faults)).not.toContain("private-corrupt-material");
    expect(JSON.stringify(f.faults)).not.toContain(f.options.keeperFile);
    expect(f.sends()).toBe(0);
  } finally { await f.close(); }
});
