# Keeper implementation progress

M07 is incomplete. Native authorization, fees, restricted signing and the durable
journal are locally verified. The complete native execution port now includes
broadcast and receipt reconciliation. The shared worker core is locally verified;
startup/root wiring remains. See [worker workflow](15_WORKER.md).

`src/_adapters/_0_solana/_1_authorize/mod.ts` implements the complete authorization
port: read, preview, prepare owner arm, and prepare owner revoke. Reads use one
confirmed batch for guard program, ProgramData, policy and native Clock. They
verify a supplied release manifest containing the exact code hash/length,
deployment slot, ProgramData address and upgrade authority. The entire binary is
hashed each time, including a check that allocation padding is zero; an upgrade
within the same slot cannot pass a cached slot-only check. The onchain policy is
decoded and matched against the complete immutable policy digest and native
route/owner/keeper/source/recipient/amount/floor/expiry fields.

No production release manifest has been created: the candidate guard is not
deployed. Tests derive a local manifest from the actual compiled SBF and SVM
loader accounts. Those local accounts are not presented as mainnet deployment
evidence. Program upgrades remain a disclosed trust dependency; a read check
cannot make an upgradeable program trustless.

Owner preparation validates supported mint/account profiles and sufficient input
balance, obtains the verified native route, and calculates rent for missing
policy/staging/recipient accounts using RPC. A missing recipient must be the
owner's canonical ATA. Existing delegates require an explicit replacement choice
at `prepareArm`; a preview never grants replacement approval. Revoke preparation
does not depend on a tradable mint and remains available for an active native
policy after its expiry.

The fee gate requests a current confirmed blockhash and RPC base fee, builds the
bounded compute-budget message, then checks its actual RPC fee and payer balance.
Account rent is separate from the fee cap but included in required payer funds.
Missing/stale fee data, excess fees, insufficient funds and expired blockhashes
reject preparation. There is no default spending budget or funded keeper key.

Tests use real local HTTP transport and actual SVM guard/token accounts.
Fee/rate-limit/block-height responses are labelled synthetic RPC controls, not
claims about current mainnet fees. Owner-signed arm and revoke transactions run
against the real compiled guard; no mainnet transaction was sent.

Verification: 119 tests / 44,927 assertions, no failures or skips; TypeScript and
architecture checks pass. Report:
`<local-fixtures>/m07-worker-tests.xml`.

`ExitPreparation` retains exact internally issued exit envelopes, requires actual
successful unsigned RPC simulation, and rechecks native authorization, holding
approval, route eligibility, fees and quote expiry before signing with the keeper.
It rejects altered/unissued messages and uses an in-flight state to permit only
one concurrent signing attempt. Failed simulation invalidates the message.
Tests execute the resulting signed transaction against the actual local guard
and CLMM; revocation, fee changes and expired quotes block signing.

The route check currently validates the private quote book and its short expiry;
it does not independently rehash the DEX at signing. Program upgrade authority
remains a trust dependency. No public signing endpoint is exposed.

`src/_shared/_0_store` implements the chain-independent journal through the kernel's
`JournalPort`. Claims use PostgreSQL time, row locks and increasing fences;
release preserves the fence history. A superseded/expired worker cannot mutate
a policy or attempt. The bounded active-policy scan supports restart discovery.
Policy documents, recorded decisions and signed attempt identities are immutable.

Preparation commits the decision, exact signed bytes, native ID, validity,
execution context and audit event together, with synchronous commit explicitly
enabled. BigInt evidence is stored as exact decimal strings. An unresolved
attempt blocks another preparation and blocks policy rearming. Retry lineage is
explicit and limited to a previously failed/expired attempt. Receipt and policy
state change atomically; RPC acceptance is only SUBMITTED. Terminal attempt
results cannot be overwritten. The native adapter still owns signature and
receipt validation; the database is not evidence of chain execution.

Tests provision only the dedicated `solstock_guard_test_journal` database and
apply migrations 001/002 inside a fixture-owned schema. They terminate an actual
test backend before commit, inject a late SQL failure, reconnect after commit,
compete for claims and recover unchanged bytes after takeover. These are database
failure tests with synthetic journal payloads, separate from actual SVM signing
and guard tests. They do not claim mainnet crash/recovery evidence.

The planned postgres.js 3.4.9 client threw an uncaught `socket.write` null error
on actual backend termination under Bun 1.3.11. Bun's built-in SQL client passes
the same test, so it is now the implementation. A similar postgres.js failure is
[reported upstream](https://github.com/porsager/postgres/issues/1066). No driver
patch or swallowed exception was used. SQL errors are logged with operation,
policy/order identity and error code, without query values or credentials.

`src/_adapters/_0_solana/_2_execution/mod.ts` composes the complete `ExecutionPort`.
Recovered bytes must have a valid keeper signature, the immutable policy digest,
a canonical packet and exactly two compute-budget instructions plus the bounded
guard execution. Reconstructing the expected message rejects extra transfers,
substituted destinations and altered permissions, even with a valid keeper
signature. This is an internal adapter, not a generic signing/relay endpoint.

The preparation layer records quote expiry in delivery metadata; send checks it
again after authorization and RPC fees. This is an offchain eligibility check,
not an onchain expiry extension: published transaction bytes remain relayable
until native blockhash/policy validity ends, subject to the guard's spending
bounds. Missing quote-expiry metadata fails delivery. No prior production
attempts exist to migrate. Reconciliation remains available after quote expiry.

Broadcast uses preflight and zero automatic RPC retries. A returned signature
must match the saved native ID, and acceptance never implies confirmation.
Reconciliation uses two distinct configured provider IDs and endpoint origins;
that configuration is not proof of independent infrastructure. Both providers
remain trusted RPC sources. Each verifies mainnet, the pinned guard deployment,
finalized native policy/Clock state, signature history and blockhash validity.
Finalized clocks must be at most 60 seconds old and provider slots within 64.

The receipt state `confirmed` means matching **finalized** transaction evidence
from both providers, matching exact message/signature, consumed native policy,
exact source debit, unchanged staging balance, sufficient recipient proceeds,
and valid keeper fee debit. Actual token mint/owner/decimals are checked in
transaction metadata. Finalized failures require matching failure receipts and
an unconsumed policy. Missing, inconsistent or unavailable evidence stays unknown.
Expiry requires absent signature history on both providers, finalized height past
the recorded validity bound, invalid blockhashes and an unconsumed native policy.
A consumed policy without this signature's receipt remains unresolved.

Eight added tests use actual local SVM execution, signatures, logs, fees and
balance deltas over HTTP. Finality/height/provider faults are labelled synthetic;
local SVM does not prove mainnet consensus. A combined PostgreSQL/native test
persists a real signed exit, reconnects under a new claim, loses the send response
and recovers one finalized receipt with no second swap. Two-provider outages
remain a live availability constraint; the private backup's last live probe
returned 429 and is still a release prerequisite.

The shared worker now waits for committed intent before sending and recovers
existing attempts first. A pending receipt preserves PREPARED/UNKNOWN state until
actual send acceptance or terminal evidence; it does not invent an accepted send.
[Worker tests](15_WORKER.md) cover the complete local path. Startup connection
bounds, migration-version verification and the single root composition remain;
no public hosted service or mainnet exit is claimed.

Primary RPC semantics checked:
[message fees](https://solana.com/docs/rpc/http/getfeeformessage),
[simulation](https://solana.com/docs/rpc/http/simulatetransaction),
[signature status](https://solana.com/docs/rpc/http/getsignaturestatuses).
