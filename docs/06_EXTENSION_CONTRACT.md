# Kernel, coverage and adapter growth rules

## Intent and implementation scope

Build one product that can support additional tokens, chains, DEXes, aggregators,
reference feeds and risk rules without rewriting its policy workflow. Implement
only Solana and the chosen stock reference feed for the first release. The interfaces below are
planning contracts to prove with that actual integration; they are not a plugin
platform or a claim that every blockchain has equivalent capabilities.

Retain the current directory until a broader name is chosen. Naming candidates:
ExitPilot, ExitGuard, Circuit, Outpost and Egress. No trademark or domain
availability has been established. The product's claims list actual supported
chains/assets; a generic name never implies universal coverage.

## Ownership boundaries

| Owner | Responsible for | Must not contain |
|---|---|---|
| `_kernel` | Pure domain types, ports, exact units, policy identity and coverage validation | SDKs, I/O, database code, concrete adapter imports or a service locator |
| `_1_feeds` | Observation scheduling, alignment and freshness | Vendor HTTP payload parsing, Solana account layouts |
| `_2_risk` | Versioned decisions over normalized evidence | Wallet/SDK objects, transaction builders, network I/O |
| `_3_execution` | Durable attempt lifecycle and retry coordination | Chain-specific nonce math or raw RPC response parsing |
| `_4_authorization` | User policy preview, arm/revoke lifecycle | PDA derivation, ERC-20 transaction encoding |
| `_5_app` | Shared workflow and clearly displayed capabilities | Server credentials or provider signing keys |
| `src/_adapters/_0_solana` | Native reads, wallet integration, route, receipts, Rust guard | EVM branches or stock-provider client code |
| `src/_adapters/_1_evm` (later) | Native reads, wallet integration, route, receipts, Solidity guard | Imports of Solana internals |
| `src/_adapters/_2_alpaca` | Subscription protocol, decoded quotes, sessions | Trading authority or decisions about customer exits |
| A chain's `_venues/<venue>` | DEX state/accounts and route validation; direct quote/build only when used | Aggregator HTTP clients, shared policy decisions or other venue internals |
| A chain's `_aggregators/<provider>` | Route discovery, API decoding, returned instruction validation | Signing authority, permission widening or assuming every returned route works |
| `config/assets`, `config/routes`, `config/providers` | Versioned coverage facts referencing registered capabilities | Executable code, secrets or unverified support claims |
| `_shared` | Store, locks, clocks and health/logging primitives | Domain rules, chain SDKs or an accumulating utilities collection |

Existing lifecycle code remains shared, while each adapter owns the facts that
can invalidate a transaction or authorization on its chain. A Solana blockhash
expiry is not equivalent to an EVM account nonce, replacement or reorg.

## Small explicit interfaces

Use separate ports rather than one enormous base class. Start with only the
operations the first vertical slice calls. Exact TypeScript signatures are
implemented and type-checked in M02; no `any`, stringly typed dispatch or runtime
loading of untrusted adapter code.

| Port | Initial operations | Required guarantees |
|---|---|---|
| `ChainReader` | Validate network; observe holdings/markets; read holding and authorization | Native payloads validated, chain-scoped identity, timestamps/cursor, explicit gaps |
| `AuthorizationPort` | Preview bounds; prepare arm/revoke; verify resulting authorization | Owner signature required; report actual enforced capabilities; signed domain binds network, guard and version |
| `ExecutionPort` | Quote; build; simulate; sign keeper attempt; broadcast; reconcile | No user key; signed bytes/native ID available before network send; native validity/replacement rules remain adapter-owned |
| `VenuePort` | Validate supported venue deployments, pools/accounts and swap semantics; direct quote/build if used | Explicit capabilities; exact assets/amounts; no arbitrary program forwarding |
| `AggregatorPort` | Discover/quote candidate routes; decode returned build instructions | Every leg/fee/intermediate asset identified and checked against supported guard capabilities; never signs |
| `WalletPort` | Connect; validate selected network; present and sign owner transactions | Separate browser-safe entry; display authorization bounds; no server signer imports |
| `ReferenceFeed` | Subscribe; report coverage/session; normalize observations | Explicit units, provider time, source identity and quality; no silent delayed-data substitute |
| `RiskRule` | Declare input requirements; evaluate normalized observations | Deterministic result, version, evidence and eligibility reason; no hidden side effects |

Each `ExecutionPort` result is typed: usable result or explicit unsupported,
unavailable, invalid or failed outcome with context. An unknown receipt remains
unknown; it must not become a fabricated failure that permits a second sale.
Quote, signature, cursor and serialized native details have adapter-owned
schemas/versioning. Shared code can journal opaque serialized data but cannot
mutate or interpret those native internals.

Build and signing are distinct from broadcasting. `_3_execution` commits the
signed attempt before calling broadcast, regardless of chain. The adapter
reconciles native status and recommends a permitted retry/rebuild action; the
shared coordinator checks the current policy and journal before following it.

The chain execution adapter composes venue and aggregator ports. A direct route
needs no aggregator. An aggregator may propose routes, but only the chosen,
verified route reaches the guard. Implement the operations actually required
by that path; do not add empty methods to make unlike integrations look equal.

## Coverage catalog and extension workflow

The kernel validates a data-only catalog. Root separately supplies a static map
of available adapter constructors. Configuration can select registered code;
it cannot load arbitrary modules, make unsupported token behavior compatible or
authorize an unrecognized program.

Coverage is a validated combination of chain/network, asset behavior profile,
input/output assets, route deployments, reference feeds and guard version.
Each record names its version, metadata source and compatibility evidence.
Required fields include native identity and raw unit scale, supported token
extensions, any display/share transformation, reference symbol/session/units,
output valuation feed and permitted route identifiers. Keep rule settings in
policy documents, not hidden asset-specific branches. Static catalog validation
does not replace startup/onchain verification or a fresh executable quote.

| Extension | Change owned by | Required evidence before enablement |
|---|---|---|
| Token using supported behavior | `config/assets` plus route/feed mappings | Verified native metadata, exact-unit accounting, fresh reference and actual supported route |
| New token behavior | Chain-local asset profile and, where necessary, native guard | Tests for extensions, fees, scaling/rebasing or restrictions actually introduced; no generic compatibility claim |
| DEX | Chain-local `_venues/<venue>` and guard route validation | Actual program/pool/account checks and bounded successful/rejected swap tests |
| Aggregator | Chain-local `_aggregators/<provider>` | API decoding, route-leg validation, malicious instruction rejection and real compatibility with the guard |
| Reference provider | Separate provider adapter | Source/session/units/freshness conformance and actual entitlement |
| Risk trigger | Versioned `src/_2_risk/_1_rules` module | Declared inputs, deterministic cases and unavailable-evidence behavior |
| Chain | Chain adapter, native guard and wallet entry | Shared conformance plus native authorization, finality and recovery tests |

Implement the first asset/route only. New catalog entries normally leave shared
workflows unchanged; new protocol behavior necessarily adds code in its owner.
Protocol-native validators must also be added onchain when the deployed guard
does not already support them. Such a change may require deployment and fresh
user approval; a configuration edit never widens a live authorization.

## Scheduling more assets and protocols

Share identical provider/asset subscriptions and normalize observations once.
Index affected policies by their actual evidence dependencies. Evaluate only
those policies on an update, using bounded queues, per-provider concurrency and
fair scheduling so a slow venue cannot monopolize the keeper. Backpressure and
stale/skipped work remain visible; receipt reconciliation is never silently
dropped. Keep this inside the initial process, with no distributed queue system.

Market observations can be shared across holders. An executable quote is keyed
by chain/network, assets, exact raw amount, venue/route constraints and relevant
state context. Freshness, recipient and user bounds are checked for the current
policy even when reusing compatible data. Never reuse one wallet's small quote
as evidence that a larger holding can exit at the same price. Tests cover cache
isolation and source failures; throughput claims require measured load tests.

## Capability and identity rules

- Registry entries explicitly list supported network identities, asset kinds,
  routes and authorization capabilities. Disabled/unimplemented entries are not
  advertised as supported. Only Solana is registered in the first release.
- Validate complete chain identities, including genesis/network identity where
  relevant; `solana` or `evm` alone is not enough. Addresses are normalized by
  their own adapter, never by a global lowercase conversion.
- Asset keys contain chain/network and native mint/contract identity. Tickers
  are display labels. Holdings, approvals, policies, quotes, cursors, attempts
  and database uniqueness/lock keys carry the same domain.
- Every amount carries its asset identity and unit scale. Distinguish raw units,
  displayed holdings, underlying shares and USD values. Lossless integer strings
  cross JSON boundaries. Asset transformations come from validated metadata;
  another asset class is not forced through stock-multiplier logic.
- Verify policy hashes against canonical, versioned serialization. Bind owner,
  chain/network, deployed guard, asset, amount, recipient, floor and expiry.
  A registration/configuration change cannot expand a signed authorization.
- Frontend capability checks improve UX; chain contracts must enforce actual
  spending restrictions. Ordinary token allowance alone is not an exit policy.
- A rule requiring unavailable evidence is unavailable for that asset/chain.
  Never substitute a generic price stop or guess the output asset's peg.
- Current exits are same-chain. Bridging, cross-chain atomicity and selling an
  entire multi-chain portfolio are separate projects within the product roadmap.

## Allowed dependency direction

```text
root.ts -> stage coordinators -> stage substeps -> kernel contracts/primitives
root.ts -> explicit adapter registry -> adapter coordinators -> native helpers
adapter internals -> kernel contracts/primitives
stage infrastructure -> shared store/health -> kernel types
app -> declared browser wallet entry + browser-safe kernel types
kernel -> no runtime/adapters/UI imports
```

Cross-boundary calls use injected ports. Concrete adapter imports are limited to
composition/registry, adapter-local tests and declared browser wallet entries.
No lateral imports between runtime stages or between adapter internals. Native
Rust/Solidity contracts are separate build boundaries with generated clients;
their generated artifacts are chain-scoped and never hand-edited.

Numbers express ownership and reading order. They do not force all steps to run
sequentially: authorization responds to user actions while feeds and the keeper
run continuously. There is exactly one repository `root.ts`. Library/native
entry points remain `mod.*`/tool-required `lib.rs`, not additional roots.

## Growing from thousands to tens of thousands of lines

1. Keep coordinators approximately <=50 physical lines and leaves <=200. Split
   by responsibility, not by arbitrary line chunks; use meaningful numbered
   substeps and preserve uniform directory siblings. Apply the telescopic pattern
   within each stage/adapter; packaging folders are not runtime wrapper layers.
2. Give each substantial module a short ownership README: public entry points,
   inputs/outputs, state it owns, dependencies, test commands and invariants.
   Add leaf helpers only when real implementation needs them.
3. Enforce import direction, cycles, browser/server isolation and file budgets
   in CI. There is no `utils` dumping ground and no central file with chain-name
   switches throughout the application. Composition is the selection point.
4. Keep native tests beside their contract, adapter conformance tests beside the
   adapter, pure rule tests beside the rule, and full workflows in `_9_tests`.
   Reuse the conformance cases for every implementation; add native failure cases
   rather than pretending shared tests cover chain-specific behavior.
5. Version public contracts, persisted records and migrations. Keep readers for
   active policy versions, or explicitly suspend unsupported versions and request
   reauthorization. Never silently reinterpret approvals after an upgrade.
6. When independently built modules become large, promote them to workspace
   packages while preserving their public ports and internal numbered layout.
   Extract for real ownership/dependency boundaries, not at an arbitrary LOC.
   One repository can retain a single application root and multiple libraries.
7. Keep one hosted service initially. Additional workers/services require evidence
   of resource or fault-isolation needs. Use chain/policy-scoped work ownership
   and bounded I/O now so one failing source cannot block unrelated health work.

This makes growth reviewable; no architecture guarantees that 100,000 lines will
remain simple without enforcing ownership and pruning unnecessary code.

## Adding a chain later

1. Select one concrete production network, asset and route; establish its exact
   data sources, accounting and permission model.
2. Implement the existing ports and a native bounded-execution guard. For EVM,
   use viem, Solidity and Foundry; allowance to a keeper key is insufficient.
3. Test authorization domain separation, recipient/amount/floor limits,
   cancellation, duplicate execution, reorgs and native transaction replacement.
4. Add its browser wallet entry and deploy/health manifests. Extend normalized
   UI capability presentation rather than cloning the app.
5. Pass adapter conformance and end-to-end tests, then register that network and
   enable a capped pilot. Source code presence alone does not enable execution.

A new price provider implements `ReferenceFeed`. A new trigger implements a
versioned `RiskRule`. Venues and aggregators follow the coverage workflow above;
they are separate integrations even when one aggregator accesses many venues.
Future lending/LP withdrawals need position adapters and protocol-specific
permission tests; an ordinary
wallet-token adapter cannot claim those capabilities.

## Competition progression

Deliver the Solana stock use case for Stocklana first. A later Colosseum
submission can demonstrate deeper reliability, pilot feedback and, if justified,
one additional EVM integration. Keep dated development and submission records,
disclose reused work, and recheck the applicable competition rules. Do not add
unused chain implementations merely to claim wider hackathon coverage.
