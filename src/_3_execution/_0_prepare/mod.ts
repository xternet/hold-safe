import type { AttemptRecord, RiskDecision, RiskInput } from "../../_kernel/mod";
import { check, evidence, value, WorkerError, type Session, type WorkerOptions } from "../_shared/mod";

export async function send(options: WorkerOptions, session: Session, attempt: AttemptRecord, signal: AbortSignal, recheck?: () => Promise<void>): Promise<void> {
  check(signal); session.claim = await options.journal.renew(session.claim, 60000); check(signal);
  if (recheck !== undefined) {
    try { await recheck(); }
    catch (error) {
      await options.journal.receipt(session.claim, attempt.id, { nativeId: attempt.signed.nativeId, state: "unknown", checkedAtMs: options.now(), context: evidence("RISK_INVALIDATED_BEFORE_SEND") });
      session.record.state = "UNAVAILABLE"; throw error;
    }
  }
  check(signal);
  const sent = await options.execution.broadcast(attempt.signed);
  if (sent.ok && sent.value.accepted) {
    await options.journal.submitted(session.claim, attempt.id); session.record.state = "SUBMITTED"; return;
  }
  const reason = sent.ok ? "Adapter did not accept the transaction" : sent.error.message;
  await options.journal.receipt(session.claim, attempt.id, { nativeId: attempt.signed.nativeId, state: "unknown", checkedAtMs: options.now(), context: evidence("SEND_UNCERTAIN", { reason }) });
  session.record.state = "UNAVAILABLE"; throw new WorkerError(reason);
}
export async function prepare(options: WorkerOptions, session: Session, input: RiskInput, decision: RiskDecision,
  previousId: string | null, signal: AbortSignal): Promise<void> {
  const quote = value(input.quote);
  if (decision.state !== "TRIGGERED" || decision.policyDigest !== session.record.digest || decision.evidence.quoteId !== quote.id ||
    options.now() < decision.evaluatedAtMs || options.now() - decision.evaluatedAtMs >= session.record.document.rule.maxAgeMs) throw new WorkerError("Trigger no longer matches fresh quote evidence");
  check(signal); session.claim = await options.journal.renew(session.claim, 60000);
  const built = value(await options.execution.build(session.record.document, quote)); check(signal);
  const simulation = value(await options.execution.simulate(built)); check(signal);
  let current = input, currentDecision = decision;
  const recheck = async () => {
    check(signal); current = await options.monitor.refresh(session.record.document, input);
    if (session.rule === null) throw new WorkerError("Risk rule missing before send");
    const evaluated = session.rule.evaluate(current, session.state); session.state = evaluated.state; currentDecision = evaluated.decision;
    if (current.gapEpoch !== input.gapEpoch || currentDecision.state !== "TRIGGERED") {
      if (currentDecision.state !== "TRIGGERED") await options.journal.recordDecision(session.claim, crypto.randomUUID(), currentDecision);
      throw new WorkerError("Risk evidence changed before execution");
    }
  };
  await recheck();
  const signed = value(await options.execution.signKeeper(session.record.digest, built)); check(signal);
  const attempt = await options.journal.prepare(session.claim, { id: crypto.randomUUID(), decisionId: crypto.randomUUID(), decision: currentDecision,
    signed, previousId, execution: evidence("SIMULATED_EXIT", { snapshot: current, simulation: simulation.context }) });
  session.record.state = "TRIGGERED";
  // A stop/deadline after commit leaves recoverable PREPARED bytes and never
  // creates a different transaction. The send helper checks the signal again.
  await send(options, session, attempt, signal, recheck);
  session.state = null;
}
