import { expect, test } from "bun:test";
import { address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { HoldingReads } from "../../../src/_adapters/_0_solana/_0_reader/_1_reads/mod";
import { readConnection } from "../../../src/_adapters/_0_solana/_shared/_4_rpc/mod";
import { quoteFixture } from "../../_6_quotes/_shared/mod";
import { assertSuccess } from "../../_0_permissions/_0_fixture/mod";
import type { Fault } from "../../../src/_kernel/mod";
import { createSolanaReader } from "../../../src/_adapters/_0_solana/_0_reader/mod";
import { fixture as socketFixture } from "../../../src/_shared/_3_socket/_test/mod";
import type { Subscription } from "../../../src/_kernel/mod";

test("real HTTP reader verifies mainnet and decodes coherent native account batches", async () => {
  const f = quoteFixture(); assertSuccess(f.arm());
  const source = f.svm.getAccount(address(f.policy.source)); if (!source.exists) throw new Error("Missing source");
  f.batch.accounts.set(f.policy.source, { owner: new PublicKey(source.programAddress), data: Buffer.from(source.data), lamports: Number(source.lamports), executable: false });
  const faults: Fault[] = [];
  let genesis = f.policy.chain.reference, status = 200, calls = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json(); calls++;
    if (status !== 200) return new Response("provider-secret", { status });
    const result = body.method === "getGenesisHash" ? genesis : { context: { slot: f.batch.slot }, value: body.params[0].map((key: string) => {
      const value = f.batch.accounts.get(key); if (value === undefined) return null;
      return { ...value, owner: value.owner.toBase58(), data: [value.data.toString("base64"), "base64"], rentEpoch: 0 };
    }) };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  } });
  const connection = readConnection(server.url.origin, "local-test", f => faults.push(f));
  const reader = new HoldingReads(connection, f.catalog, f => faults.push(f), () => f.batch.observedAtMs);
  try {
    const value = await reader.readHolding(f.policy);
    expect(value.ok).toBe(true); if (value.ok) expect(value.value.allowanceRaw).toBe(f.a.amount.toString());
    expect(calls).toBe(2); expect(reader.health().healthy).toBe(true);
    status = 429; expect((await reader.readHolding(f.policy)).ok).toBe(false);
    expect(reader.health().healthy).toBe(false); expect(faults.some(f => f.context.status === "429")).toBe(true);
    expect(JSON.stringify(faults)).not.toContain("provider-secret");
    status = 200; genesis = "wrong-network";
    const foreign = new HoldingReads(connection, f.catalog, f => faults.push(f), () => f.batch.observedAtMs);
    const before = calls; expect((await foreign.readHolding(f.policy)).ok).toBe(false); expect(calls - before).toBe(1);
  } finally { await server.stop(true); }
});

test("ChainReader subscriptions combine real sockets, HTTP and native decoding and stop cleanly", async () => {
  const f = quoteFixture(); assertSuccess(f.arm());
  const source = f.svm.getAccount(address(f.policy.source)); if (!source.exists) throw new Error("Missing source");
  f.batch.accounts.set(f.policy.source, { owner: new PublicKey(source.programAddress), data: Buffer.from(source.data), lamports: Number(source.lamports), executable: false });
  const faults: Fault[] = [], stops: Subscription[] = [];
  const socket = await socketFixture("solana");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.json();
    const result = body.method === "getGenesisHash" ? f.policy.chain.reference : { context: { slot: f.batch.slot }, value: body.params[0].map((key: string) => {
      const value = f.batch.accounts.get(key); if (value === undefined) return null;
      return { ...value, owner: value.owner.toBase58(), data: [value.data.toString("base64"), "base64"], rentEpoch: 0 };
    }) };
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  } });
  const reader = createSolanaReader(readConnection(server.url.origin, "local-test", f => faults.push(f)), socket.url, f.catalog, f => faults.push(f), () => f.batch.observedAtMs);
  const counts = [0, 0];
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; }), timeout = setTimeout(finish, 2000);
  try {
    for (let i = 0; i < 2; i++) {
      const result = await reader.subscribeHolding(f.policy, event => {
        if (!event.ok) throw new Error(event.error.message);
        expect(event.value.delegate).toBe(f.a.policy.toBase58()); counts[i] = counts[i]! + 1;
        if (counts.every(count => count > 0) && socket.subscriptions() === 2) finish();
      });
      if (!result.ok) throw new Error(result.error.message); stops.push(result.value);
    }
    await done; expect(counts.every(count => count > 0)).toBe(true);
    expect(socket.connections()).toBe(1); expect(socket.subscriptions()).toBe(2); expect(reader.health().healthy).toBe(true);
    await stops[0]!.stop(); const stoppedCount = counts[0], activeCount = counts[1]!;
    await Bun.sleep(1100); expect(counts[0]).toBe(stoppedCount); expect(counts[1]!).toBeGreaterThan(activeCount);
    await stops[1]!.stop(); expect(faults).toEqual([]);
  } finally { clearTimeout(timeout); for (const stop of stops) await stop.stop(); await socket.stop(); await server.stop(true); }
});
