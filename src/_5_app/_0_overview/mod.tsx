import { assetKey } from "../../_kernel/mod";
import { supportedWallet } from "../../_adapters/_0_solana/_4_wallet/mod";
import { useService } from "../_shared/_0_service/mod";
import { useIdentity } from "../_shared/_1_identity/mod";
import { Activity } from "../_2_activity/mod";
import { ArmPolicy } from "../_1_arm/mod";
export function Overview() {
  const service = useService(), identity = useIdentity(), health = service.health;
  const now = Date.now();
  const fresh = health !== null && [health.worker.checkedAt, health.chain.checkedAt, ...health.feeds.map(feed => feed.checkedAt)]
    .every(time => now >= time && now - time < 15000);
  const healthy = fresh && health.worker.healthy && health.chain.healthy && health.feeds.length > 0 && health.feeds.every(feed => feed.healthy);
  return <main>
    <header><a className="brand" href="/">◈ <span>HoldSafe</span></a><span className="network">SOLANA MAINNET</span></header>
    <section className="hero"><p className="eyebrow">A CLEAR PLAN FOR THE UNEXPECTED</p><h1>Your stocks.<br/>Your exit rules.</h1>
      <p className="lead">Watch the gap between tokenized stocks and their stock-market reference. Authorize a bounded exit while keeping control of your wallet.</p>
      <div className={`status ${healthy ? "good" : "warn"}`}><span className="dot"/>{healthy ? "Monitoring available" : "Monitoring unavailable"}</div>
      <p className="muted">Authorization stays onchain. Missing or stale evidence stops automatic decisions.</p>
    </section>
    {service.error !== null && <p role="alert" className="notice">Service unavailable: {service.error}</p>}
    <div className="grid"><section className="card"><p className="eyebrow">01 / YOUR WALLET</p><h2>Connect on your terms.</h2>
      <p>Sign-in proves ownership. It does not approve spending. Each authorization needs a separate wallet signature.</p>
      {identity.session === null ? <div className="wallets">{identity.wallets.length === 0 && <p className="empty">No compatible wallet detected</p>}
        {identity.wallets.map((wallet, index) => <button key={`${wallet.name}-${index}`} disabled={identity.busy || !supportedWallet(wallet)} onClick={() => { void identity.login(wallet); }}>{supportedWallet(wallet) ? `Connect ${wallet.name}` : `${wallet.name} — unsupported capabilities`}</button>)}</div> :
        <><p className="address">{identity.session.wallet.owner}</p><button className="secondary" onClick={() => { void identity.logout(); }}>Disconnect</button></>}
      {identity.error !== null && <p role="alert" className="notice">{identity.error}</p>}
    </section><section className="card"><p className="eyebrow">02 / SUPPORTED COVERAGE</p><h2>One route. Explicit limits.</h2>
      {service.coverage === null ? <p>Loading verified coverage…</p> : service.coverage.catalog.routes.map(route => {
        const input = service.coverage!.catalog.assets.find(asset => assetKey(asset.ref) === assetKey(route.input));
        const output = service.coverage!.catalog.assets.find(asset => assetKey(asset.ref) === assetKey(route.output));
        return <div key={route.id}><h3>{input?.symbol} → {output?.symbol}</h3><p className="muted">Wallet-held tokens · Raydium CLMM · One successful exit per policy</p><details><summary>Asset and program identities</summary><p className="address">Input: {route.input.address}<br/>Output: {route.output.address}<br/>Guard: {service.coverage!.guard}</p></details></div>;
      })}
      {health !== null && <ul className="sources">{[health.chain, ...health.feeds].map(item => <li key={item.source}><strong>{item.source}</strong><span>{item.healthy ? "Available" : item.reason}</span></li>)}</ul>}
    </section></div>
    {identity.session !== null && service.coverage !== null && <ArmPolicy key={identity.session.wallet.owner} session={identity.session} coverage={service.coverage}/>}
    {identity.session !== null && service.coverage !== null && <Activity session={identity.session} coverage={service.coverage}/>}
    <section className="trust"><h2>Know what you authorize.</h2><div className="grid three"><p><strong>Your keys stay yours.</strong><br/>Only a policy program address can move the approved amount along the permitted route.</p><p><strong>Timing requires trust.</strong><br/>The operator chooses when to request an exit. Program upgrades are also a trust dependency.</p><p><strong>An exit is not guaranteed.</strong><br/>Your minimum proceeds, freezes, liquidity and unavailable feeds can prevent execution.</p></div></section>
    <footer>HoldSafe · Bounded permissions, visible coverage. <span>One stock token. One exit. Your decision.</span></footer>
  </main>;
}
