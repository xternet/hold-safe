import type { Fault } from "../../_kernel/mod";

export async function foreground(run: (signal: AbortSignal) => Promise<void>, log: (fault: Fault) => void): Promise<void> {
  const controller = new AbortController(), stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await run(controller.signal); }
  catch {
    process.exitCode = 1;
    log({ code: "UNAVAILABLE", message: "Service stopped with an error; inspect redacted component diagnostics", retryable: true,
      context: { component: "service" } });
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
