import { readFileSync } from "node:fs";
import { PublicKey, SYSVAR_CLOCK_PUBKEY, type AccountInfo } from "@solana/web3.js";
import { type Catalog, type Policy, validateCatalog } from "../../../src/_kernel/mod";
import { fixture } from "../../_0_permissions/_0_fixture/mod";
import { GUARD, ORDER } from "../../_0_permissions/_shared/mod";

export function quoteFixture() {
  const f = fixture();
  const catalog = validateCatalog(JSON.parse(readFileSync("config/coverage.json", "utf8")) as Catalog);
  const route = catalog.routes[0]!, input = catalog.assets[0]!, output = catalog.assets[1]!;
  const policy: Policy = { schema: 1, chain: route.chain, orderId: ORDER.toString("hex"),
    owner: f.a.owner.publicKey.toBase58(), keeper: f.a.keeper.publicKey.toBase58(), source: f.a.source.toBase58(),
    input: input.ref, output: output.ref, amountRaw: f.a.amount.toString(), recipient: f.a.output.toBase58(),
    minimumOutputRaw: "1", slippageBps: 100, expiresAt: Number(f.now) + 3600,
    guard: GUARD.toBase58(), guardVersion: route.guardVersion, routeId: route.id,
    rule: { id: "divergence", version: 1, thresholdBps: 300, persistenceMs: 3000, maxAgeMs: 5000, maxSkewMs: 2000, maxImpactBps: 100, maxOutputDeviationBps: 100 },
    coverage: { inputProfile: input.profile, outputProfile: output.profile, inputReference: input.reference,
      outputReference: output.reference, venue: route.venue, pool: route.pool, program: route.program, programVersion: route.programVersion } };
  const accounts = new Map<string, AccountInfo<Buffer>>();
  for (const account of f.snapshot.accounts) accounts.set(account.address, {
    owner: new PublicKey(account.owner), data: Buffer.from(account.data, "base64"),
    executable: account.executable, lamports: account.lamports,
  });
  const clock = accounts.get(SYSVAR_CLOCK_PUBKEY.toBase58());
  if (clock === undefined) throw new Error("Missing captured clock");
  return { ...f, catalog, policy, batch: { slot: f.snapshot.slot, accounts,
    programVersion: route.programVersion, observedAtMs: Number(clock.data.readBigInt64LE(32)) * 1000 } };
}
