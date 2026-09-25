# Owner policy workflow

`_4_authorization` is the port-only workflow used by the authenticated HTTP API.
It takes an authenticated owner identity separately from the policy. The API
obtains this identity through wallet challenge verification; the wallet UI remains
to implement. See `18_AUTH_HTTP.md` for the HTTP/session boundary.

Preview validates the owner, configured keeper/guard, chain, versioned catalog
and current policy expiry. The native authorization adapter supplies actual
route/account checks, estimated fees/allocation and trust limitations. Only a
successful preview persists an immutable DRAFT and returns its digest.

Arm takes that stored digest and an explicit delegate-replacement choice. It
rechecks ownership, acquires a fenced claim and asks the native adapter to prepare
an unsigned owner transaction. It renews the claim and commits ARMING before
returning that transaction. Database failure, conflicting ownership or unavailable
native preparation returns an explicit fault, never a transaction to sign.
Preparing a transaction does not establish onchain authorization or mark a policy
ARMED. The worker observes native authority and current risk evidence separately.

Admission from DRAFT to ARMING uses a PostgreSQL transaction advisory lock and
counts all unresolved monitored policies across service processes. The maximum is
128, matching the current worker/monitor capacity. DRAFT and terminal states do
not consume capacity; a pending or uncertain attempt still does. The existing
unique source-account constraint also remains enforced. Capacity checks do not
increase throughput or claim support beyond this measured implementation limit.

Status requires the stored owner and returns immutable policy state, the current
native authorization outcome, and the latest attempt's state/signature/receipt.
It never returns the saved keeper-signed packet. An unavailable native read is an
explicit outcome; it is not represented as active authorization. Worker state
and native state remain distinct, so the UI can show why monitoring is unavailable
without pretending the owner's onchain authorization has been revoked.

Revocation preparation requires the owner but does not acquire the keeper's
journal claim. An owner must remain able to cancel while an exit is pending.
The native adapter prepares an owner-signed cancellation; chain ordering resolves
a cancellation/exit race. No HTTP request alone changes onchain authority, and
revocation preparation does not mark a policy REVOKED before chain evidence.

Integration tests combine the real journal, actual guard/token programs and owner
signatures for preview/arm/revoke. They reject foreign-owner/operator requests,
claim conflicts and database admission failure. A labelled synthetic journal
intent is used only to test response filtering and is never sent. A separate
real PostgreSQL test races two admissions at the 128-policy boundary and verifies
that terminal policies release capacity. Browser and mainnet journey evidence
still belongs to later M08–M10 work.
