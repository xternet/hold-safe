import { expect, test } from "bun:test";
import { LiveCalendar } from "./mod";
import type { Fault } from "../../../_kernel/mod";

test("live calendar requests authenticate, share in-flight work and invalidate failed refreshes", async () => {
  let requests = 0, status = 200;
  const faults: Fault[] = [];
  const now = Date.parse("2026-09-23T15:00:00Z");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    requests++;
    expect(request.headers.get("APCA-API-KEY-ID")).toBe("local-key");
    expect(request.headers.get("APCA-API-SECRET-KEY")).toBe("local-secret");
    expect(new URL(request.url).pathname).toBe("/v2/calendar");
    return Response.json(status === 200 ? [{ date: "2026-09-23", open: "09:30", close: "16:00" }] : { message: "local-secret" }, { status });
  } });
  const calendar = new LiveCalendar({ key: "local-key", secret: "local-secret" }, (fault) => faults.push(fault), () => now, server.url.origin);
  try {
    expect(calendar.session(now)).toBe("unknown");
    await Promise.all([calendar.refresh(), calendar.refresh()]);
    expect(requests).toBe(1); expect(calendar.session(now)).toBe("regular");
    expect(calendar.session(now + 86400000)).toBe("closed");
    status = 429; await calendar.refresh();
    expect(calendar.session(now)).toBe("unknown");
    expect(faults[0]!.context.status).toBe("429");
    expect(JSON.stringify(faults)).not.toContain("local-secret");
  } finally { await calendar.stop(); await server.stop(true); }
});

test("calendar staleness and malformed payloads fail closed", async () => {
  let now = Date.parse("2026-09-23T15:00:00Z"), malformed = false;
  const faults: Fault[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() {
    return Response.json(malformed ? [{ date: "invalid", open: "09:30", close: "16:00" }] : [{ date: "2026-09-23", open: "09:30", close: "16:00" }]);
  } });
  const calendar = new LiveCalendar({ key: "local-key", secret: "local-secret" }, (fault) => faults.push(fault), () => now, server.url.origin);
  try {
    await calendar.refresh(); expect(calendar.session(now)).toBe("regular");
    now += 3600000; expect(calendar.session(now)).toBe("unknown");
    malformed = true; await calendar.refresh(); expect(calendar.session(now)).toBe("unknown");
    expect(faults.length).toBe(1);
  } finally { await calendar.stop(); await server.stop(true); }
});
