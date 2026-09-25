import type { Fault } from "../../_kernel/mod";
export type Defer = (label: string, close: () => Promise<void>) => void;

export async function withResources<T>(log: (fault: Fault) => void, work: (defer: Defer) => Promise<T>): Promise<T> {
  const resources: { label: string; close: () => Promise<void> }[] = [];
  try { return await work((label, close) => resources.push({ label, close })); }
  finally {
    let failed = false;
    for (const resource of resources.reverse()) {
      try { await resource.close(); }
      catch {
        failed = true;
        log({ code: "UNAVAILABLE", message: "Resource cleanup failed; details redacted", retryable: true,
          context: { component: "service-lifecycle", resource: resource.label } });
      }
    }
    if (failed) throw new Error("Resource cleanup failed");
  }
}
