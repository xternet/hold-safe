import type { usePolicy } from "../_2_policy/mod";
export function PolicyStatus({ state, onRevoke }: { state: ReturnType<typeof usePolicy>; onRevoke(): void }) {
  const { view, native, busy, signature, error } = state;
  return <div className="policy-status">
    <p>Onchain authorization: {native}</p><p>Keeper record: {view === null ? "unavailable" : view.record.state}</p>
    {view?.authorization.ok === false && <p className="notice">{view.authorization.error.message}</p>}
    <button className="secondary" disabled={busy} onClick={state.refresh}>Refresh onchain status</button>
    <button className="secondary" disabled={busy || !["active", "expired"].includes(native)} onClick={onRevoke}>Revoke in wallet</button>
    {signature !== null && <p className="address">Wallet submission: {signature}. Submission alone is not confirmation.</p>}
    {view?.attempt !== null && view?.attempt !== undefined && <p className="address">Exit attempt: {view.attempt.state} · {view.attempt.nativeId} · receipt {view.attempt.receipt === null ? "unavailable" : view.attempt.receipt.state}</p>}
    {error !== null && <p role="alert" className="notice">{error}</p>}
  </div>;
}
