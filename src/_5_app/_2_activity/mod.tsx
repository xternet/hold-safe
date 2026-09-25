import { useState } from "react";
import type { PolicyRecord } from "../../_kernel/mod";
import type { Coverage } from "../_shared/_0_service/mod";
import type { Login } from "../_shared/_1_identity/mod";
import { useHistory } from "./_0_history/mod";
import { ManagePolicy } from "./_1_manage/mod";
export function Activity({ session, coverage }: { session: Login; coverage: Coverage }) {
  const history = useHistory(session), [selected, setSelected] = useState<PolicyRecord | null>(null);
  return <><section className="card activity"><p className="eyebrow">YOUR POLICIES</p><h2>Authorization history</h2>
    <button className="secondary" disabled={history.loading} onClick={history.refresh}>Refresh history</button>
    {history.error !== null ? <p role="alert" className="notice">{history.error}</p> : history.loading ? <p>Loading policy history…</p> : history.rows.length === 0 ? <p>No policies on this page.</p> :
      history.rows.map(policy => <article key={policy.digest}><strong>{policy.state}</strong><p className="address">{policy.digest}</p><p>Approved input: {policy.document.amountRaw} raw units</p>
        <button className="secondary" aria-label={`Manage policy ${policy.digest}`} onClick={() => setSelected(policy)}>Manage</button></article>)}
    <nav aria-label="Policy history pages"><button className="secondary" disabled={history.loading || history.page === 1} onClick={history.previous}>Previous policies</button>
      <span>Page {history.page}</span><button className="secondary" disabled={history.loading || !history.more} onClick={history.next}>Next policies</button></nav>
  </section>{selected !== null && <ManagePolicy key={selected.digest} session={session} coverage={coverage} record={selected}/>}</>;
}
