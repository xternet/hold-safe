import { useEffect, useState, type FormEvent } from "react";
import { assetKey, canonicalPolicy, policyDigest, type PolicyPreview, type WalletInventory } from "../../../_kernel/mod";
import { request, type Coverage } from "../../_shared/_0_service/mod";
import type { Login } from "../../_shared/_1_identity/mod";
import { decimalRaw, makeDraft } from "../_0_draft/mod";
import { scaledDisplay, type Reviewed } from "../_shared/mod";

export function PolicyForm({ session, coverage, onReview }: { session: Login; coverage: Coverage; onReview(review: Reviewed): void }) {
  const [routeId, setRouteId] = useState(coverage.catalog.routes[0]!.id), [inventory, setInventory] = useState<WalletInventory | null>(null);
  const [source, setSource] = useState(""), [portion, setPortion] = useState("100"), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [floor, setFloor] = useState(""), [threshold, setThreshold] = useState("3"), [persistence, setPersistence] = useState("3");
  const [slippage, setSlippage] = useState("1"), [hours, setHours] = useState("24"), [fee, setFee] = useState("0.00001");
  const [replace, setReplace] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setInventory(null); setError(null); setSource(""); setReplace(false);
    void request<WalletInventory>("wallet/inventory", { routeId }, session.token, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.owner !== session.wallet.owner || value.routeId !== routeId) throw new Error("Inventory owner or route mismatch");
      setInventory(value); setSource(value.holdings.length === 0 ? "" : value.holdings[0]!.account);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Inventory unavailable"); });
    return () => controller.abort();
  }, [session, routeId, refresh]);
  const route = coverage.catalog.routes.find(item => item.id === routeId)!;
  const asset = coverage.catalog.assets.find(item => assetKey(item.ref) === assetKey(route.input))!;
  const output = coverage.catalog.assets.find(item => assetKey(item.ref) === assetKey(route.output))!;
  const holding = inventory?.holdings.find(item => item.account === source);
  const amountRaw = holding === undefined ? "0" : (BigInt(holding.balanceRaw) * BigInt(portion) / 100n).toString();
  async function preview(event: FormEvent) {
    event.preventDefault(); if (busy || holding === undefined || inventory === null) return;
    setBusy(true); setError(null);
    try {
      // Preview re-reads native holdings/fees; the displayed balance is never an authorization.
      const policy = makeDraft(coverage, session.wallet.owner, routeId, { source, recipient: inventory.recipient, amountRaw,
        minimumOutput: floor, thresholdPercent: threshold, persistenceSeconds: persistence, slippagePercent: slippage, lifetimeHours: hours }, Date.now());
      const maximumNetworkFeeRaw = decimalRaw(fee, 9), digest = await policyDigest(policy);
      const result = await request<PolicyPreview>("policies/preview", { policy }, session.token);
      if (result.digest !== digest || canonicalPolicy(result.policy) !== canonicalPolicy(policy)) throw new Error("Preview differs from your policy");
      if (BigInt(result.networkFeesRaw) > BigInt(maximumNetworkFeeRaw)) throw new Error("Estimated network fee exceeds your cap");
      onReview({ preview: { ...result, policy }, maximumNetworkFeeRaw, replaceExistingApproval: replace });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview unavailable"); }
    finally { setBusy(false); }
  }
  return <section className="card activity"><p className="eyebrow">03 / YOUR EXIT POLICY</p><h2>Choose what to protect.</h2>
    <form onSubmit={event => { void preview(event); }}><fieldset disabled={busy}>
      <label>Supported route<select value={routeId} onChange={event => setRouteId(event.target.value)}>{coverage.catalog.routes.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>
      <button type="button" className="secondary" onClick={() => setRefresh(value => value + 1)}>Refresh balances</button>
      {inventory === null ? <p>Loading verified accounts…</p> : inventory.holdings.length === 0 ? <p>No eligible {asset.symbol} accounts found.</p> : <>
        <label>Source token account<select value={source} onChange={event => { setSource(event.target.value); setReplace(false); }}>{inventory.holdings.map(item => <option key={item.account} value={item.account}>{item.account}</option>)}</select></label>
        <label>Portion of balance<select value={portion} onChange={event => setPortion(event.target.value)}>{[10, 25, 50, 100].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>
        {holding !== undefined && <p>Protect approximately {scaledDisplay(amountRaw, asset.decimals, holding.multiplier)} {asset.symbol}. Exact authorization: {amountRaw} raw units. Display is rounded down; percentage amounts round down to a raw unit.</p>}
        <div className="grid"><label>Minimum proceeds ({output.symbol})<input required inputMode="decimal" value={floor} onChange={event => setFloor(event.target.value)}/></label>
          <label>Divergence threshold (%)<input required inputMode="decimal" value={threshold} onChange={event => setThreshold(event.target.value)}/></label>
          <label>Persistence (seconds)<input required inputMode="decimal" value={persistence} onChange={event => setPersistence(event.target.value)}/></label>
          <label>Slippage limit (%)<input required inputMode="decimal" value={slippage} onChange={event => setSlippage(event.target.value)}/></label>
          <label>Expires after (hours)<input required inputMode="numeric" value={hours} onChange={event => setHours(event.target.value)}/></label>
          <label>Network fee cap (SOL)<input required inputMode="decimal" value={fee} onChange={event => setFee(event.target.value)}/></label></div>
        <p>A high proceeds floor may prevent an exit. A low floor permits a larger loss. Missing or closed-market feeds stop automatic decisions.</p>
        {holding?.delegate !== null && holding?.delegate !== undefined && <p className="address">Existing delegate: {holding.delegate} · allowance {holding.allowanceRaw} raw units</p>}
        <label className="check"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)}/>Allow replacement of an existing token approval.</label>
        <button type="submit" disabled={holding === undefined || amountRaw === "0"}>{busy ? "Checking native authorization…" : "Review policy"}</button>
      </>}
      {inventory?.excluded.map(item => <p className="notice" key={item.account}>Excluded {item.account}: {item.reason}</p>)}
    </fieldset></form>{error !== null && <p role="alert" className="notice">{error}</p>}
  </section>;
}
