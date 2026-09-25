import type { AuthorizationPort, Claim, ExecutionPort, Fault, JournalPort, MonitorPort, NativeContext,
  PolicyRecord, PolicyState, RiskFactory, RiskRule, RiskState, Subscription, Outcome } from "../../_kernel/mod";
export type WorkerOptions = { id: string; journal: JournalPort; authorization: Pick<AuthorizationPort, "read">;
  execution: ExecutionPort; monitor: MonitorPort; risk: RiskFactory; now: () => number; log: (fault: Fault) => void };
export type Session = { record: PolicyRecord; claim: Claim; rule: RiskRule | null; watch: Subscription | null;
  state: RiskState | null; lastDecision: string | null };
export class WorkerError extends Error {}
export function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new WorkerError(result.error.message); return result.value;
}
export function evidence(reason: string, detail: unknown = {}): NativeContext {
  return { adapter: "worker-v1", version: 1, serialized: JSON.stringify({ reason, detail }, (_key, value: unknown) => typeof value === "bigint" ? value.toString() : value) };
}
export async function change(options: WorkerOptions, session: Session, next: PolicyState, context: NativeContext) {
  if (session.record.state === next) return;
  await options.journal.transition(session.claim, session.record.state, next, context); session.record.state = next;
}
export function check(signal: AbortSignal) { signal.throwIfAborted(); }
