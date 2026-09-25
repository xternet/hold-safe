# M01 delegated swap feasibility

These tests execute captured mainnet Raydium CLMM, Token, Token-2022 and Memo
programs in LiteSVM. User balances and signing keys are local fixtures. No test
sends a transaction to a live network. The probe is deliberately not a guard:
it has no policy authentication and MUST NOT be deployed or imported by the app.

Capture real accounts and program bytes into the mounted cold filesystem:

```sh
bun run _9_tests/_2_swap/_0_capture/mod.ts /agents/shared/config/keys.env /srv/cold/solstock-guard/NEW_CAPTURE
```

The collector checks mainnet genesis, pool mints/program, account existence,
loader states and ELF headers. It records per-account/binary SHA-256 and context
slots. The token/pool accounts share one getMultipleAccounts context; program
bytes are captured separately with their own slots. This is a current-state
local snapshot, not a historical transaction replay or full mainnet equivalence.

Build the test probe with project-local Agave 4.3.0, platform-tools v1.57:

```sh
env RUSTC=/home/multi/.cache/solana/v1.57/platform-tools/rust/bin/rustc DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus XDG_RUNTIME_DIR=/run/user/1000 CARGO_BUILD_JOBS=4 systemd-run --user --scope -p MemoryMax=8G -p CPUQuota=400% .tools/solana-release/bin/cargo-build-sbf --no-rustup-override --manifest-path _9_tests/_2_swap/_2_probe/Cargo.toml --sbf-out-dir .tools/m01-probe --jobs 4
SOLSTOCK_SNAPSHOT=/srv/cold/solstock-guard/NEW_CAPTURE/snapshot.json bun run test:route
bun run typecheck
```

Required results: owner-signed swap succeeds; a directly delegated CLMM source
fails its owner constraint; a PDA delegates a transfer into its staging account
then swaps atomically; insufficient allowance and impossible floor restore the
original user balances and allowance. The PDA success must produce the same
output as the independent owner-signed baseline on identical pool state.

Passing these tests proves the route/authority mechanism only. Final guard
permissions, policy replay, native revocation, mainnet transaction size/fees,
feed eligibility and hosted recovery require their own milestone evidence.
