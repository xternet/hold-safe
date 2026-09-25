# Repository map

The checkout is `<checkout>`. Like SVM Replay, shipped code is
under `src/`, integration checks under `tests/`, and guides under `docs/`.
HoldSafe retains its numbered workflow stages inside `src/`.

```text
src/             Application and domain implementation
  _0_setup/      Configuration and startup
  _1_feeds/      Market observations
  _2_risk/       Risk evaluation
  _3_execution/  Exit workflow
  _4_authorization/ Wallet permissions
  _5_app/        Browser UI and HTTP API
  _adapters/     Chains, venues and data providers
  _kernel/       Domain types and policy semantics
  _shared/       Storage and infrastructure
tests/           Integration and architecture checks
config/          Asset and route configuration
migrations/      Database schema
deploy/          Service configuration
docs/            Guides and design notes
```

Start with `src/root.ts`: it composes typed adapters and workflows. The browser
never imports server adapters. `_kernel` remains independent of chain SDKs,
network access and persistence. Each chain owns its native authorization,
transaction and venue code. Adding a chain requires a real adapter and tests;
there is no placeholder EVM implementation.

## Entry points

| Purpose | Location |
|---|---|
| Service composition | `src/root.ts` |
| Current demo UI | `src/_5_app/_5_demo/` |
| Result proof/progress | `src/_5_app/_6_demo_evidence/` |
| Devnet runtime/API | `src/_adapters/_0_solana/_7_demo/` |
| Native guard | `src/_adapters/_0_solana/` |
| Policy contracts | `src/_kernel/` |
| Architecture enforcement | `tests/_4_structure/` |
| Service unit | `deploy/demo/hold-safe-devnet-demo.service` |

Component tests stay beside their owner. Integration tests retain their numbered
suite directories. One composition entry and small `mod` files preserve the
existing telescopic architecture. The structure checker still rejects cross-stage
implementation imports, browser/server leaks, cycles and oversized source files.

## Local state and compatibility

Ignored `secrets/`, `.tools/`, `node_modules/`, `dist/` and `dist-demo/` contain
local credentials, fixtures, dependencies and generated output. Never publish
keys. Cold evidence retains its original `<local-evidence>/` location.
Signed policy namespaces, native program IDs, `SOLSTOCK_*` environment variables
and the `solstock_guard` database schema are compatibility identifiers, not the
product brand. Renaming them would invalidate existing configuration or policies.
The isolated demo service is configured in `deploy/demo/holdsafe-isolated.service`.

Numbered design documents contain the implementation history; older snippets may
show pre-migration paths. This map and the root README describe the current layout.

## Validation

```sh
bun run typecheck
bun test tests/_4_structure tests/_15_release
bun run demo:build
PLAYWRIGHT_BROWSERS_PATH=.tools/playwright \
SOLSTOCK_SNAPSHOT=<local-fixtures>/snapshot.json \
SOLSTOCK_TEST_DATABASE=solstock_guard_test bun test
```

The full suite needs captured native fixtures, locally built SBF programs and the
isolated test database. `SOLSTOCK_LIVE_DEMO=1` additionally enables the explicitly
scoped Devnet packet conformance test. Never substitute canned fixture outputs.
