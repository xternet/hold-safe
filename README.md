# HoldSafe

> “I want to hold stocks on-chain, but DeFi feels too risky for me.”
>
> “I want to exit my positions quickly when something goes wrong, but I don’t know how to code that safely.”
>
> “I want to automate my portfolio, but I don’t want to run a server 24/7 or give anyone my private key.”

HoldSafe lets you choose risk signals, authorize exit limits in your wallet, and
automatically execute a bounded exit when those conditions are met. It can combine
executable prices, reference prices, token behavior, liquidity conditions, and
external market events. The current demo uses a tokenized AAPL example and
simulates price divergence and supply anomalies on Solana Devnet.

## How it works

1. The user selects an asset, amount, and risk signals.
2. The wallet signs a bounded policy containing the permitted asset, amount,
   route, recipient, minimum proceeds, expiry, and one-time execution rule.
3. HoldSafe’s restricted keeper evaluates the configured signals.
4. When a rule triggers, the keeper submits the exit transaction.
5. The on-chain guard rejects anything outside the signed policy, and the user
   can verify the transaction and balance changes.

The user’s private key remains in the wallet. The keeper uses a separate,
restricted execution key, so the user does not need to run a server 24/7.

## Extensible protection

Future adapters could extend HoldSafe to other assets, positions and chains. Triggers can
use on-chain signals, market events, or any programmable rule derived from
internet data.

## Repository architecture

The numbered modules keep the flow readable and isolate chain-specific code.
LOC figures are approximate TypeScript source counts.

```text
src/_0_setup          startup and configuration                 ~366 LOC
src/_1_feeds          market and chain observations              ~90 LOC
src/_2_risk           risk rules and trigger decisions          ~337 LOC
src/_3_execution      durable exit workflow                     ~222 LOC
src/_4_authorization  wallet policy and delegation               ~99 LOC
src/_5_app            browser UI and HTTP API                   ~935 LOC
src/_kernel           domain types, ports, and policy semantics ~753 LOC
src/_adapters         Solana, venues, and data providers      ~3,993 LOC
src/_shared           persistence and common infrastructure     ~588 LOC
tests                 integration and architecture checks     ~3,630 LOC
config                supported assets and routes                 config
migrations            database schema                             SQL
deploy                service and reverse-proxy examples          config
docs                  public design and operating notes            docs
```

## How to run

Requires Bun 1.3.11 and the pinned dependencies in `bun.lock`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun test tests/_4_structure
bun run build
bun run demo:build
```

See [Devnet setup and limitations](docs/29_DEVNET_DEMO.md). Run the configured service with `bun start`. The Devnet demo requires the protected local
fixture configuration described in the deployment files. Never commit wallet
keys, credentials, databases, or generated build output.
