# Native guard v1 — local validation

M03 implements the real Anchor program under
`src/_adapters/_0_solana/program/`. It is **not deployed or audited**. Its candidate
program ID is `HNpQ9dn9Prr97FrQQoU3auhRgHiAsCWwsTy45kde9yvL`.
The deployment key is local and ignored by Git; no funds were sent to it.

## Authority and wire contract

- `authorize`: owner signs; creates `PDA("policy", owner, order_id)` and performs
  Token-2022 `ApproveChecked` to that PDA atomically. Existing delegation requires
  the signed `replace_delegate` flag. Source must hold the full authorized amount.
- `execute`: designated keeper signs. Only the stored exact-input Raydium CLMM
  route is constructed. Transfer, swap, delta checks and policy consumption are
  atomic. The stricter of user floor and attempt floor applies. The keeper never
  supplies arbitrary CPI instruction bytes, an input amount or a new recipient.
- `revoke`: owner signs; marks the policy revoked and removes its SPL approval
  if that approval is still current. Cancellation does not remove another newer
  delegate. An ordinary SPL revoke independently disables execution.

Anchor instructions use standard eight-byte discriminators and Borsh arguments.
Authorization arguments in order: 32-byte order, 32-byte policy digest, 32-byte
mainnet domain, u8 version, u64 input, u64 floor, i64 expiry, bool replacement.
Execute takes u64 attempt floor; revoke has no arguments. All integers are LE.

Policy data after the eight-byte discriminator: u8 version/state/bump; five
public keys (owner, keeper, source, staging, recipient); order and digest;
u64 amount/floor; i64 expiry; ten route public keys. Total account size: 579
bytes. Route key order is documented directly in the Rust `Policy` type.
States: 1 active, 2 consumed, 3 revoked; elapsed expiry disables active policies.
Terminal accounts remain as replay tombstones, so the same order cannot re-arm.

## Token and route coverage

Input is a supported Token-2022 profile, output classic SPL Token. This matches
the proven AAPLx/USDC route. Mints, programs, pool, config, vaults, observation,
staging and recipient are pinned. Pool membership, native token owners, mint
decimals and tick/bitmap membership are checked. No aggregator is implemented.

Allowed mint extensions: metadata pointer/metadata, permanent delegate, initialized
default state, positive finite scaled UI amounts, unpaused pausable config,
disabled transfer hook and confidential mint with auto-approval disabled.
Other extensions fail. Normal account extensions are limited to immutable
owner, inactive transfer-hook account and pausable-account marker. Checks run
again at execution. Frozen accounts, fees and enabled hooks are unsupported.

Only the fixed approved amount is staged during execution. A third party can
donate dust to any token account: existing staging dust is preserved by exact
delta checks, so it cannot prevent an otherwise valid exit merely by making
the staging balance nonzero. Policy and staging rent are not reclaimed in v1.

## Evidence and limits

Sixteen permission tests passed against the actual captured mainnet DEX/token
binaries in LiteSVM. They cover correct owner/keeper flow, altered accounts and
routes, zero/invalid bounds, replay, both revocation methods, explicit replacement,
expiry, insufficient/excess allowance, dust, mint changes, aliases and rollback
followed by retry. Combined M01–M03 suite: 37 pass, 0 fail; 43,739 assertions.
JUnit: `<local-fixtures>/m03-tests.xml`.

Build using the already installed project-local toolchain, in a bounded scope:

```sh
env RUSTC=/home/multi/.cache/solana/v1.57/platform-tools/rust/bin/rustc \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus XDG_RUNTIME_DIR=/run/user/1000 \
  CARGO_BUILD_JOBS=4 systemd-run --user --scope -p MemoryMax=8G -p CPUQuota=400% \
  .tools/solana-release/bin/cargo-build-sbf --no-rustup-override \
  --manifest-path _adapters/_0_solana/program/Cargo.toml --sbf-out-dir .tools/guard --jobs 4
```

Compiled SBF is 264,632 bytes; SHA-256
`99bfb79be7687e0832ff33809a10c8ab81bd83ee4efa7b3c49a2de17e55bae36`.
Authorization and execution also enforce the scheduled corporate-action pause
described in [document 24](24_CORPORATE_ACTIONS.md); revocation remains available.
Build uses locked Anchor 0.32.1/SPL dependencies, Agave 4.3.0, platform tools
v1.57 and default `no-idl` feature. Anchor IDL mutation instructions are excluded.
The lockfile pins transitive Anchor macros at 0.32.2 and Token-2022 at 8.0.1.
See [Anchor version notes](https://www.anchor-lang.com/docs/updates/release-notes/0-32-1)
and the [pinned SPL manifest](https://github.com/solana-foundation/anchor/blob/v0.32.1/spl/Cargo.toml).

The keeper remains trusted for timing and availability. Issuer mint/freeze,
permanent-delegate and pause authorities remain external risks. Raydium's captured
deployment slot is 439846317, upgrade authority
`FytDrVzDybM1TwFQPGb8qaxZR7dBCzNeqT3vtQsceZQK`; its captured binary digest is
recorded in M01 evidence. The guard pins the DEX address and validates balances;
it does not freeze third-party program code. A deployed upgradeable guard also
requires trust in its upgrade authority, which must be recorded before release.
Offchain adapters must suspend mismatched recorded deployment versions.

Mainnet identity is verified by the runtime RPC adapter. The program validates
the signed domain tag but cannot independently read a genesis-hash sysvar.
These are local snapshot tests with fixture balances, not mainnet receipts,
an uptime claim, independent security review or proof of fair trigger timing.
