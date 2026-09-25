import { useState } from "react";
import { canonicalPolicy, type PolicyPreview, type PolicyRecord } from "../../../_kernel/mod";
import { request, type Coverage } from "../../_shared/_0_service/mod";
import type { Login } from "../../_shared/_1_identity/mod";
import { usePolicy } from "../../_shared/_2_policy/mod";
import { PolicyStatus } from "../../_shared/_3_status/mod";
import { PolicyReview } from "../../_1_arm/_2_review/mod";
import { decimalRaw } from "../../_1_arm/_0_draft/mod";
import type { Reviewed } from "../../_1_arm/_shared/mod";
type Props = { session: Login; coverage: Coverage; record: PolicyRecord };
export function ManagePolicy(props: Props) {
  const [review, setReview] = useState<Reviewed | null>(null);
  return review === null ? <Details {...props} onReview={setReview}/> :
    <PolicyReview session={props.session} coverage={props.coverage} review={review} onBack={() => setReview(null)}/>;
}
function Details({ session, coverage, record, onReview }: Props & { onReview(review: Reviewed): void }) {
  const policy = record.document, state = usePolicy(session, policy, record.digest, coverage.catalog);
  const [fee, setFee] = useState("0.00001"), [replace, setReplace] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function review() {
    if (busy) return; setBusy(true); setError(null);
    try {
      const maximumNetworkFeeRaw = decimalRaw(fee, 9);
      const preview = await request<PolicyPreview>("policies/preview", { policy }, session.token);
      if (preview.digest !== record.digest || canonicalPolicy(preview.policy) !== canonicalPolicy(policy)) throw new Error("Preview differs from stored policy");
      if (BigInt(preview.networkFeesRaw) > BigInt(maximumNetworkFeeRaw)) throw new Error("Estimated network fee exceeds your cap");
      onReview({ preview: { ...preview, policy }, maximumNetworkFeeRaw, replaceExistingApproval: replace });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Policy preview unavailable"); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setError(null);
    try { await state.send("revoke", decimalRaw(fee, 9)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid fee cap"); }
  }
  const current = state.view?.record.state;
  const recoverable = current !== undefined && ["DRAFT", "ARMING", "UNAVAILABLE"].includes(current) &&
    state.native === "absent" && policy.expiresAt * 1000 > Date.now();
  return <section className="card activity"><p className="eyebrow">STORED POLICY</p><h2>Policy details</h2>
    <p className="address">{record.digest}</p><dl><dt>Exact approved input / minimum output</dt><dd>{policy.amountRaw} / {policy.minimumOutputRaw} raw units</dd>
      <dt>Source / recipient</dt><dd className="address">{policy.source}<br/>{policy.recipient}</dd>
      <dt>Input / output mint</dt><dd className="address">{policy.input.address}<br/>{policy.output.address}</dd>
      <dt>Guard / route</dt><dd className="address">{policy.guard}<br/>{policy.routeId}</dd>
      <dt>Expires</dt><dd>{new Date(policy.expiresAt * 1000).toISOString()}</dd></dl>
    <p>Revocation needs your wallet signature. A completed exit cannot be undone. Pending exit and revocation transactions may race.</p>
    <label>Network fee cap for this action (SOL)<input inputMode="decimal" value={fee} disabled={busy || state.busy} onChange={event => setFee(event.target.value)}/></label>
    <p>The wallet confirms current base fees. The reviewed fee cap is not an onchain total-fee cap.</p>
    <PolicyStatus state={state} onRevoke={() => { void revoke(); }}/>
    {recoverable && <><label className="check"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/>Allow replacement of an existing token approval.</label>
      <button disabled={busy || state.busy} onClick={() => { void review(); }}>Review existing authorization</button>
      <p>This keeps the same one-shot policy identity and bounds. A previously submitted approval may still arrive.</p></>}
    {error !== null && <p role="alert" className="notice">{error}</p>}
  </section>;
}
