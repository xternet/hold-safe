import { expect, test } from "bun:test";
import { AccountWatch } from "./mod";
import { fixture } from "../../../../_shared/_3_socket/_test/mod";
import type { Fault, Subscription } from "../../../../_kernel/mod";

test("two policies share native account and slot subscriptions; notifications are only read hints", async () => {
  const server = await fixture("solana"), faults: Fault[] = [], stops: Subscription[] = [], slots: number[] = [];
  const watch = new AccountWatch(server.url, f => faults.push(f));
  let finish!: () => void;
  const done = new Promise<void>(resolve => { finish = resolve; }), timeout = setTimeout(finish, 1500);
  try {
    for (let i = 0; i < 2; i++) stops.push(watch.subscribe(["SysvarC1ock11111111111111111111111111111111"], slot => {
      slots.push(slot); if (slots.length === 2) finish();
    }, () => { throw new Error("Unexpected gap"); }));
    await done;
    expect(slots).toEqual([42, 42]); expect(server.subscriptions()).toBe(1); expect(server.connections()).toBe(1);
    expect(watch.health().healthy).toBe(true);
    await stops[0]!.stop(); expect(watch.health().healthy).toBe(true);
    await stops[1]!.stop(); expect(watch.health().healthy).toBe(false); expect(faults).toEqual([]);
  } finally { clearTimeout(timeout); for (const stop of stops) await stop.stop(); await server.stop(); }
});
