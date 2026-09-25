# Sustained-divergence rule

M06 implements `divergence@1` behind the kernel `RiskRule` contract. It imports no
chain SDK, performs no network calls and holds no signing key. Construction takes
an isolated copy of the validated policy/catalog and computes the actual policy
digest. Decisions bind that digest and rule version, quote ID, price/holding
observation IDs, source times, native authorization evidence and exact valuations.
The keeper will assign durable decision IDs and journal evidence in M07.

The completed v1 policy schema requires explicit `maxImpactBps` and
`maxOutputDeviationBps`, each an integer from 0 through 9,999. They are signed
constraints, not mutable server defaults. Missing/extra rule fields fail
validation. No live policies have been deployed; no existing signed policy is
silently migrated. The onchain layout is unchanged: its stored hash already
binds the complete policy document.

Eligibility requires a current regular stock session, matching consolidated
reference and output feed, fresh ordered timestamps within the owner's skew
limit, valid non-crossed bid/ask observations, sufficient wallet balance and
approval, and a fresh active authorization identifying the expected delegate.
The quote must match the exact policy, amount, chain, assets and route, remain
unexpired, and honor both the hard floor and quote-relative slippage minimum.
Excessive price impact, output bid/ask outside the authorized dollar band or
insufficient output-reference bid depth makes the rule unavailable.

Valuation uses exact rational arithmetic:

```
shares = raw input / 10^input decimals * active multiplier
reference USD = shares * stock bid USD
exit USD = raw quoted output / 10^output decimals * output bid USD
discount bps = 10000 * (reference USD - exit USD) / reference USD
```

A qualifying window starts at the current evaluation time. Elapsed qualifying
time advances only through the oldest source timestamp among stock, output,
holding, quote and authorization. Repeated evaluation of unchanged evidence
cannot advance persistence. Source regression, ineligible evidence, a reported
gap, an evaluation gap reaching `maxAgeMs`, recovery below threshold, or a change
in the active multiplier resets the window. A restart starts with no window.
This is evidence-based sampled persistence, not proof that every instant between
observations had the same market state.

Example verified by hand: one raw-normalized token at multiplier 1.5 and a $200
stock bid has $300 reference value. An executable 290 USDC at a $1 bid is a
333⅓ bps discount. Three seconds of new eligible source evidence meets a 300 bps,
three-second rule; waiting three seconds on the original snapshot does not.

Tests also cover raw integers above JavaScript's safe-integer range, a one-unit
threshold boundary, 90 independently checked integer valuation combinations,
closed/unknown sessions, depeg/depth/impact/floor failures, revoked/altered
authorization and cross-domain evidence. All remain local synthetic cases,
clearly separate from real live observations.

The expanded tests exposed a Bun 1.3.11 `structuredClone` defect: copying
`{ n: 1n, a: shared, b: shared }` replaces `b` with `1n`. Node preserves the
object reference. Domain DTOs now use a small tested plain-record/array copier
that preserves BigInts and alias identity while isolating the original; it
rejects cycles and non-domain objects. Feed delivery, quote storage and risk
evidence use this copier. No global runtime monkey-patch is installed.

Full suite: 78 passing tests, plus TypeScript and architecture checks. Report:
`<local-fixtures>/m06-tests.xml`. This proves local rule
behavior, not live SIP access, a detected incident or a successful mainnet exit.
