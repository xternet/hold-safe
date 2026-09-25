import { expect, test } from "bun:test";
import { BoundedScheduler } from "./mod";
import type { Fault } from "../../_kernel/mod";

test("scheduler bounds concurrency, coalesces keyed reads and fairly drains accepted work", async () => {
  const faults: Fault[] = [], ran: string[] = [];
  const queue = new BoundedScheduler(2, 2, 1000, f => faults.push(f));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  queue.submit("a", async () => { ran.push("a"); await gate; });
  queue.submit("b", async () => { ran.push("b"); await gate; });
  expect(queue.submit("a", async () => { ran.push("obsolete"); })).toBe("queued");
  expect(queue.submit("a", async () => { ran.push("latest-a"); })).toBe("coalesced");
  expect(queue.submit("c", async () => { ran.push("c"); })).toBe("queued");
  expect(queue.submit("d", async () => { ran.push("d"); })).toBe("full");
  expect(queue.stats()).toEqual({ active: 2, pending: 2, coalesced: 1, rejected: 1 });
  release(); await queue.stop();
  expect(ran).toEqual(["a", "b", "latest-a", "c"]);
  expect(faults.length).toBe(1); expect(faults[0]!.message).toContain("capacity");
  expect(queue.submit("e", async () => {})).toBe("stopped");
});
test("stalled task does not block another worker or release its slot before actually finishing", async () => {
  const faults: Fault[] = [], ran: string[] = [];
  const queue = new BoundedScheduler(2, 2, 30, f => faults.push(f));
  let release!: () => void, observedAbort!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const aborted = new Promise<void>(resolve => { observedAbort = resolve; });
  queue.submit("stalled", async signal => { signal.addEventListener("abort", observedAbort, { once: true }); await gate; });
  queue.submit("healthy", async () => { ran.push("healthy"); });
  await aborted;
  expect(ran).toEqual(["healthy"]); expect(queue.stats().active).toBe(1);
  expect(faults.some(f => f.message.includes("deadline"))).toBe(true);
  release(); await queue.stop(); expect(queue.stats().active).toBe(0);
});
