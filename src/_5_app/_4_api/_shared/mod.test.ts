import { expect, test } from "bun:test";
import { body } from "./mod";

test("slow request body is cancelled at its deadline and cannot authenticate from a partial document", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"owner":"unfinished"')); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://guard.example/api/auth/challenge", {
    method: "POST", headers: { "content-type": "application/json" }, body: stream,
  });
  const faults: unknown[] = [], started = performance.now();
  await expect(body(request, fault => faults.push(fault))).rejects.toThrow("Body timeout");
  expect(cancelled).toBe(true);
  expect(performance.now() - started).toBeLessThan(4500);
  expect(faults).toEqual([]);
});
