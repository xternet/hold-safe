import { copyValue } from "../../_kernel/mod";
import { prepare } from "../_0_prepare/mod";
import { recover } from "../_1_recover/mod";
import { change, check, evidence, value, WorkerError, type Session, type WorkerOptions } from "../_shared/mod";

export async function evaluate(options: WorkerOptions, session: Session, signal: AbortSignal): Promise<boolean> {
  const latest = await options.journal.latest(session.record.digest); check(signal);
  if (latest !== null && ["PREPARED", "SUBMITTED", "UNKNOWN"].includes(latest.state)) return recover(options, session, latest, signal);
  const authorization = await options.authorization.read(copyValue(session.record.document)); check(signal);
  if (authorization.ok && authorization.value.state === "absent" && options.now() >= session.record.document.expiresAt * 1000) {
    await change(options, session, "EXPIRED", authorization.value.context); return true;
  }
  if (!authorization.ok || authorization.value.state === "absent" || authorization.value.state === "consumed") {
    session.state = null;
    const reason = authorization.ok ? `NATIVE_${authorization.value.state.toUpperCase()}` : authorization.error.message;
    await change(options, session, "UNAVAILABLE", evidence(reason)); return false;
  }
  if (authorization.value.state === "revoked" || authorization.value.state === "expired") {
    await change(options, session, authorization.value.state === "revoked" ? "REVOKED" : "EXPIRED", authorization.value.context); return true;
  }
  if (session.rule === null) {
    session.rule = await options.risk(copyValue(session.record.document));
    if (session.rule.policyDigest !== session.record.digest) throw new WorkerError("Rule policy digest differs");
  }
  if (session.watch === null) session.watch = value(await options.monitor.watch(copyValue(session.record.document)));
  const input = await options.monitor.snapshot(copyValue(session.record.document), authorization); check(signal);
  const result = session.rule.evaluate(input, session.state); session.state = result.state;
  if (result.decision.state !== "TRIGGERED") {
    const identity = JSON.stringify([result.decision.state, result.decision.reason]);
    if (identity !== session.lastDecision) {
      await options.journal.recordDecision(session.claim, crypto.randomUUID(), result.decision); session.lastDecision = identity;
    }
    await change(options, session, result.decision.state === "UNAVAILABLE" ? "UNAVAILABLE" : "ARMED", authorization.value.context);
    return false;
  }
  await change(options, session, "ARMED", authorization.value.context);
  await prepare(options, session, input, result.decision, latest === null ? null : latest.id, signal);
  return false;
}
