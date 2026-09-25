# Product contract

## Outcome

A stock-token holder connects a wallet, authorizes a bounded sale and then
disconnects. A hosted service watches the selected market and requests an exit
when the user's enabled rule fires. The user can inspect the reason, state and
transaction, or cancel without relying on our website.

Target the Stocklana main competition. Sponsor integrations are implementation
choices, not a dependency of eligibility. Cash awards are competitive; the
plan assumes no prize income and assigns no invented probability of winning.

The long-term product is automatic exits for supported assets across multiple
chains. Tokenized stocks on Solana are the first complete use case. A future
Colosseum submission can build on that release with disclosed development
history; adding EVM is a separate implementation phase, not an expansion of
the current deadline. Naming and eligibility do not imply implemented coverage.

## Explicit planning assumptions

- Product name/repository path: `HoldSafe`, `<checkout>`;
  HoldSafe is chain- and asset-independent; the operational path is retained for compatibility.
- Hosted execution replaces the earlier local private-key design.
- Tokens start in a normal user-owned token account, outside DeFi protocols.
- Candidate observed asset: AAPLx; candidate output: USDC. These are research
  candidates until M01 records verified mint addresses, units, feed access and
  a compatible route. Unsupported candidates remain visibly unsupported.
- Mainnet is the sole deployed target. Use existing real token markets; do not
  build Devnet/Testnet adapters, mint demo tokens or create a demo market.
- First execution release is a controlled pilot using a dedicated team wallet
  with capped real funds. Local unit/SVM tests precede it. A deliberate test
  condition must be labelled; never describe it as a naturally detected incident.
- One fixed raw amount, one source account and one atomic, one-shot exit per
  authorization. No partial fills, trailing stops or recurring authorizations.
- The user controls divergence threshold, persistence interval, slippage limit,
  maximum price impact, permitted output-dollar deviation, explicit minimum
  output, and expiry. UI presets are visible choices, never
  replacements for missing configuration.

## User journey

1. Open the hosted app. Display mainnet asset identity and coverage. Public
   visitors can observe; the initial execution pilot is limited to designated
   team wallet policies. There is no network-selection UI.
2. Connect a wallet. Read its public balances. The private key stays in the wallet.
3. Preview reference price, estimated exit proceeds, fees and monitoring health.
4. Enter amount, rule settings, fixed minimum proceeds and expiry. Explain that
   the operator is trusted to decide when a server-evaluated trigger occurred.
5. Sign policy creation plus capped token approval to the policy's PDA. Verify
   the confirmed onchain state before displaying ARMED.
6. Disconnect the wallet/browser. The hosted keeper continues monitoring.
7. When the rule fires, the keeper obtains a fresh quote and prepares a permitted
   swap. It pays transaction fees and submits the program call with its own key.
8. The program validates the authorization, atomically stages the approved input
   into a PDA-owned token account for the selected CLMM path, performs the swap, verifies
   account changes and marks the policy consumed atomically. Proceeds reach the
   user's specified output token account.
9. Show confirmed execution with transaction link, reason and actual proceeds.
   Re-arming requires a new wallet authorization.
10. Cancel through a wallet-signed onchain operation. Include an independent
    revoke recipe. A server-side pause alone is not revocation.

## Risk model

The server is allowed to choose timing within the authorization; it must not be
able to change the authorized asset, quantity, destination or price floor. A
malicious operator could still cause an unwanted sale at a permitted price, or
withhold service. This is bounded delegated execution, not trustless detection.
An upgradeable program adds upgrade-authority trust. Document deployed binaries
and authority before any release; a one-day demo does not justify production
security claims.

The program cannot access Alpaca HTTP/WebSocket data by itself. New offchain
detectors can later issue the same typed decision without changing the executor.
Changing an existing user's rule requires a new owner-authorized policy/hash;
server upgrades must preserve the rule version or suspend it visibly.

## First trigger: executable-value divergence

Use exact raw token units onchain. For an xStock whose active multiplier denotes
shares per raw token unit after decimal normalization:

```
shares = raw_amount / 10^input_decimals * active_multiplier
reference_usd = shares * fresh_stock_bid_usd
exit_usd = quoted_output_raw / 10^output_decimals * fresh_output_usd
discount_bps = 10_000 * (reference_usd - exit_usd) / reference_usd
```

M01 must confirm these semantics for the chosen asset/feed. Pin the bid/ask
definition and multiplier effective time; do not double-apply a provider's
adjustment. Keep integer raw amounts and explicit decimal/rational arithmetic;
do not use JavaScript floating-point token balances.

Require valid references, aligned timestamps, an open supported stock session,
acceptable source confidence, sufficient output-asset health and a supported
quote. Fire only after the threshold persists across the selected interval
without an unacceptable data gap. Estimate small versus full-position impact
to distinguish execution-size effects from divergence. No valid quote means
NO_ROUTE, not a fabricated zero price and automatic market dump.

Do not treat normal mint issuance or stock splits as attacks. Outside the
supported equity session, this rule is unavailable; continue account monitoring
and show the gap. A future standalone stop rule would be a separately enabled
policy, not an automatic fallback.

Slippage is measured against a fresh quote offchain. The onchain hard floor is
the user-authorized minimum output; enforce the stricter of that floor and any
quoted minimum provided for this attempt. The program must not pretend to
independently establish that the quote was fair. An absolute floor can prevent
an exit during a severe collapse; explain this tradeoff before arming.

## Scope boundaries

Included: one stock reference adapter, one chain stream plus independent backup
RPC, one exit path, server rule evaluation, wallet approval/revocation, capped
mainnet pilot execution, transaction recovery, clear health and evidence.

Later: more assets/routes, configurable compound detectors, oracle-verifiable
triggers, independent keepers, fee reimbursement, DeFi position unwinds, and
production customer-fund release. Each needs specific compatibility tests.

M01 selected a direct Raydium CLMM AAPLx/USDC path. Owner-held input remains in
the wallet until execution; the staging transfer and swap succeed or revert
together. See [actual route evidence](09_M01_EVIDENCE.md).

Future chains use dedicated adapters and native guard contracts, following the
[extension contract](06_EXTENSION_CONTRACT.md). Shared rules operate on verified
asset observations, not Solana account structures. Supporting another chain
does not automatically support its tokens, venues or DeFi positions. Exits stay
within one chain; bridging and atomic cross-chain execution are separate scope.

Not promised: universal hack prediction, guaranteed exits, protection through
halts/frozen token accounts/empty pools, all-hours valid stock references,
insurance, a profitable trading strategy, or zero loss.
