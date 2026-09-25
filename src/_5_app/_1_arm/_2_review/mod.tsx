import { useState } from "react";
import { assetKey } from "../../../_kernel/mod";
import { type Coverage } from "../../_shared/_0_service/mod";
import type { Login } from "../../_shared/_1_identity/mod";
import { usePolicy } from "../../_shared/_2_policy/mod";
import { PolicyStatus } from "../../_shared/_3_status/mod";
import { scaledDisplay, type Reviewed } from "../_shared/mod";

export function PolicyReview({ session, coverage, review, onBack }: { session: Login; coverage: Coverage; review: Reviewed; onBack(): void }) {
  const { preview, maximumNetworkFeeRaw, replaceExistingApproval } = review, policy = preview.policy;
  const output = coverage.catalog.assets.find(item => assetKey(item.ref) === assetKey(policy.output))!;
  const state = usePolicy(session, policy, preview.digest, coverage.catalog);
  const [accepted, setAccepted] = useState(false);
  const { native, busy, attempted } = state;
  return <section className="card activity"><p className="eyebrow">04 / REVIEW BEFORE SIGNING</p><h2>Review your authorization</h2>
    <dl><dt>Approved input</dt><dd>{policy.amountRaw} raw units</dd><dt>Minimum proceeds</dt><dd>{scaledDisplay(policy.minimumOutputRaw, output.decimals, { n: "1", d: "1" })} {output.symbol} ({policy.minimumOutputRaw} raw units)</dd>
      <dt>Divergence / persistence</dt><dd>{policy.rule.thresholdBps / 100}% for {policy.rule.persistenceMs / 1000} seconds</dd>
      <dt>Slippage / expiry</dt><dd>{policy.slippageBps / 100}% · {new Date(policy.expiresAt * 1000).toISOString()}</dd>
      <dt>Freshness / maximum timestamp skew</dt><dd>{policy.rule.maxAgeMs / 1000}s / {policy.rule.maxSkewMs / 1000}s</dd>
      <dt>Maximum price impact / output USD deviation</dt><dd>{policy.rule.maxImpactBps / 100}% / {policy.rule.maxOutputDeviationBps / 100}%</dd>
      <dt>Estimated network fee / account allocation</dt><dd>{preview.networkFeesRaw} / {preview.allocationRaw} lamports</dd>
      <dt>Reviewed network fee cap</dt><dd>{maximumNetworkFeeRaw} lamports. Wallet confirms current base fees; this is not an onchain total-fee cap.</dd>
      <dt>Replace existing approval</dt><dd>{replaceExistingApproval ? "Explicitly allowed" : "Not allowed"}</dd>
      <dt>Source / recipient</dt><dd className="address">{policy.source}<br/>{policy.recipient}</dd>
      <dt>Input / output mint</dt><dd className="address">{policy.input.address}<br/>{policy.output.address}</dd>
      <dt>Guard / keeper / route</dt><dd className="address">{policy.guard}<br/>{policy.keeper}<br/>{policy.routeId}</dd></dl>
    {preview.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}
    <p>One successful exit. The operator controls timing; program upgrades are a trust dependency. Floors, liquidity, freezes and unavailable evidence can prevent execution. This approval does not guarantee protection.</p>
    <label className="check"><input type="checkbox" checked={accepted} disabled={attempted} onChange={event => setAccepted(event.target.checked)}/>I understand the operator can request an exit within these bounds.</label>
    <button disabled={!accepted || busy || native !== "absent"} onClick={() => { void state.send("arm", maximumNetworkFeeRaw, replaceExistingApproval); }}>{attempted ? "Retry same authorization" : "Authorize in wallet"}</button>
    {attempted && native === "absent" && <p>Current chain state is absent. A prior submission may still arrive; retry uses the same one-shot policy, never a new approval identity.</p>}
    <button className="secondary" disabled={busy || attempted} onClick={onBack}>Back to form</button>
    <PolicyStatus state={state} onRevoke={() => { void state.send("revoke", maximumNetworkFeeRaw); }}/>
  </section>;
}
