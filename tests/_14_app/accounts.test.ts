import { expect, test } from "bun:test";
import { createWalletInventory } from "../../src/_adapters/_0_solana/_6_inventory/mod";
import { authorizationFixture } from "../_8_authorization/_shared/mod";

test("wallet inventory re-reads actual mint/account/Clock and preserves exact balance units", async () => {
  const f = await authorizationFixture();
  const inventory = createWalletInventory(f.connection, f.catalog, e => f.faults.push(e), f.now);
  try {
    const result = await inventory.list(f.policy.owner, f.policy.routeId);
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error.message);
    expect(result.value.owner).toBe(f.policy.owner); expect(result.value.recipient).toBe(f.policy.recipient);
    expect(result.value.holdings).toHaveLength(1); expect(result.value.excluded).toEqual([]);
    const holding = result.value.holdings[0]!;
    expect(holding.account).toBe(f.policy.source);
    expect(holding.balanceRaw).toBe(Buffer.from(f.get(f.policy.source).data).readBigUInt64LE(64).toString());
    expect(BigInt(holding.multiplier.n)).toBeGreaterThan(BigInt(holding.multiplier.d));
    expect(holding.sourceAtMs).toBe(f.now());
    expect(() => JSON.stringify(result.value)).not.toThrow();
    f.controls.inventoryAccounts = [];
    const empty = await inventory.list(f.policy.owner, f.policy.routeId);
    expect(empty.ok && empty.value.holdings.length === 0).toBe(true);
    f.controls.inventoryAccounts = [f.policy.source, f.policy.source];
    expect((await inventory.list(f.policy.owner, f.policy.routeId)).ok).toBe(false);
    f.controls.inventoryAccounts = Array(98).fill(f.policy.source);
    expect((await inventory.list(f.policy.owner, f.policy.routeId)).ok).toBe(false);
    expect((await inventory.list(f.policy.owner, "unknown-route")).ok).toBe(false);
    expect((await inventory.list("invalid-wallet", f.policy.routeId)).ok).toBe(false);
    f.controls.genesis = "wrong-mainnet";
    expect((await inventory.list(f.policy.owner, f.policy.routeId)).ok).toBe(false);
  } finally { await f.stop(); }
});

test("inventory exposes frozen/foreign account exclusions and rejects stale chain evidence", async () => {
  const f = await authorizationFixture();
  const inventory = createWalletInventory(f.connection, f.catalog, e => f.faults.push(e), f.now);
  try {
    const original = f.get(f.policy.source), frozen = Buffer.from(original.data); frozen[108] = 2;
    f.svm.setAccount({ ...original, data: frozen });
    const result = await inventory.list(f.policy.owner, f.policy.routeId);
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.error.message);
    expect(result.value.holdings).toEqual([]); expect(result.value.excluded[0]?.account).toBe(f.policy.source);
    expect(result.value.excluded[0]?.reason).toContain("Token account");
    const foreign = Buffer.from(original.data); foreign.set(f.a.keeper.publicKey.toBytes(), 32);
    f.svm.setAccount({ ...original, data: foreign });
    const mismatch = await inventory.list(f.policy.owner, f.policy.routeId);
    expect(mismatch.ok && mismatch.value.excluded.length === 1).toBe(true);
    const stale = createWalletInventory(f.connection, f.catalog, e => f.faults.push(e), () => f.now() + 5000);
    expect((await stale.list(f.policy.owner, f.policy.routeId)).ok).toBe(false);
    expect(f.faults.length).toBeGreaterThanOrEqual(3);
  } finally { await f.stop(); }
});
