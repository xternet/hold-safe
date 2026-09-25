# Devnet demo

Open https://holdsafe.xyz and choose a recorded walkthrough or a live Solflare test.
Live mode uses free Devnet SOL, demoAAPL and demoUSD; these are not real stocks.
Connect a fresh Devnet wallet, select an amount and protections, approve, then
simulate price divergence or abnormal supply. Inspect the explorer receipts and
reset to try the other event. Recorded mode sends no transactions.

The stock reference is synthetic. Optional Alpaca IEX data is informational.
The keeper evaluates triggers off-chain; the guard enforces execution bounds.
Frozen tokens, insufficient liquidity, RPC outages or price floors can prevent an exit.
The prototype is unaudited. The demo program remains upgradeable by its operator.

Live tests share one market: only one wallet session can run at a time. Each wallet
receives one grant, with a capped total and bounded resets. Wait and retry if busy.
Wallet approval rejection can be retried or reset. Never use mainnet funds here.

Self-hosting requires a separately provisioned Devnet guard, pool, token accounts,
operator keypair and environment configuration. These private fixtures are not
included in a public clone. See the environment loader under
src/_adapters/_0_solana/_7_demo/_2_chain and .env.example for required fields.
