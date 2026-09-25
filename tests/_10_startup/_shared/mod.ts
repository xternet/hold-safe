import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliveryFixture } from "../../_8_authorization/_3_delivery/_shared/mod";

export async function startupFixture() {
  const f = await deliveryFixture(), dir = await mkdtemp(join(tmpdir(), "solstock-startup-"));
  const keeperFile = join(dir, "keeper.json"), guardManifest = join(dir, "guard.json");
  await writeFile(keeperFile, JSON.stringify([...f.a.keeper.secretKey]), { mode: 0o600 });
  await writeFile(guardManifest, JSON.stringify(f.manifest));
  const options = { primary: f.sources[0]!.connection.rpcEndpoint, backup: f.sources[1]!.connection.rpcEndpoint,
    websocket: "ws://127.0.0.1:1", keeperFile, guardManifest, catalog: f.catalog,
    fees: { computeUnitLimit: 1000000, microLamports: "0", maxFeeLamports: "10000" },
    policy: f.options.policy, log: f.options.log, now: f.now };
  return { ...f, options, async close() { await f.stop(); await rm(dir, { recursive: true }); } };
}

