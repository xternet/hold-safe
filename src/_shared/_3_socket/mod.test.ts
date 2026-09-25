import { expect, test } from "bun:test";
import { fixture } from "./_test/mod";
import { ReconnectingSocket } from "./mod";


test("real socket reconnects after disconnect and stops without reopening", async () => {
  const frames: string[] = [], gaps: string[] = [];
  let received!: () => void;
  const done = new Promise<void>((resolve) => { received = resolve; });
  const server = await fixture("reconnect");
  const socket = new ReconnectingSocket({ url: server.url, source: "local-fixture",
    reconnectMs: 10, maximumReconnectMs: 40, idleMs: 1000,
    onOpen() {}, onFrame(frame) { frames.push(frame); if (frames.length === 1) socket.send("seen"); if (frames.length === 2) received(); },
    onGap(reason) { gaps.push(reason); },
  });
  const timeout = setTimeout(() => received(), 1500);
  try {
    socket.start(); await done;
    expect(frames).toEqual(["connection-1", "connection-2"]);
    expect(gaps.some((reason) => reason.includes("connection closed"))).toBe(true);
    await socket.stop(); await Bun.sleep(70);
    expect(server.connections()).toBe(2); expect(() => socket.send("after-stop")).toThrow();
  } finally { clearTimeout(timeout); await socket.stop(); await server.stop(); }
});

test("malformed frames produce a visible gap", async () => {
  const gaps: string[] = [];
  let failed!: () => void;
  const failure = new Promise<void>((resolve) => { failed = resolve; });
  const server = await fixture("malformed");
  const socket = new ReconnectingSocket({ url: server.url, source: "local-fixture",
    reconnectMs: 100, maximumReconnectMs: 100, idleMs: 1000,
    onOpen() {}, onFrame(frame) { JSON.parse(frame); }, onGap(reason) { gaps.push(reason); failed(); },
  });
  const timeout = setTimeout(() => failed(), 1000);
  try {
    socket.start(); await failure;
    expect(gaps).toContain("local-fixture: invalid frame");
  } finally { clearTimeout(timeout); await socket.stop(); await server.stop(); }
});

test("idle and oversized connections invalidate observations visibly", async () => {
  for (const mode of ["idle", "oversized"] as const) {
    const gaps: string[] = [];
    let notify!: () => void;
    const done = new Promise<void>((resolve) => { notify = resolve; });
    const server = await fixture(mode);
    const socket = new ReconnectingSocket({ url: server.url, source: "local-fixture", reconnectMs: 250,
      maximumReconnectMs: 500, idleMs: 50, onOpen() {},
      onFrame() { throw new Error("Fixture frame must be rejected before delivery"); },
      onGap(reason) { gaps.push(reason); notify(); } });
    const timeout = setTimeout(notify, 1000);
    try {
      socket.start(); await done;
      expect(gaps).toContain(`local-fixture: ${mode === "idle" ? "connection idle timeout" : "oversized or non-text frame"}`);
    } finally { clearTimeout(timeout); await socket.stop(); await server.stop(); }
  }
});
