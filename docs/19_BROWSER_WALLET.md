# Browser wallet adapter

`src/_adapters/_0_solana/_4_wallet/mod.ts` is the declared browser-safe entry.
This document describes its wallet and transaction boundary; documents 20–22
cover the implemented React application and complete local browser journey.

Wallet discovery uses Wallet Standard registration events. Eligible wallets and
accounts must support Solana mainnet, message signing, version-0 wallet-native
sign-and-send, connection/disconnection and account-change events. Unsupported
wallets remain discoverable so the UI can explain missing capabilities. No
private server RPC URL or arbitrary transaction relay is required: the wallet
submits through its own provider. A receipt signature does not establish service
protection; native status must still be checked by the existing API/worker.

Message signing requires the exact original sign-in bytes and a valid Ed25519
signature from the selected account. A wallet that prefixes/changes the message
is rejected explicitly. The account is checked again after the signing prompt;
a missing or changed account requires reconnection. Discovery/event subscriptions
return unsubscribe functions for the UI lifecycle.

Before any transaction prompt, the adapter copies the local review and server
envelope, validates policy/domain/owner, computes the policy digest and reconstructs
the complete allowed arm or revoke message. It permits one unsigned owner signer,
no address lookup tables, two bounded compute-budget instructions and only the
expected ATA allocation/guard instructions. It checks explicit delegate replacement,
amount, recipient, floor, expiry, route and instruction permissions through exact
compiled-message comparison. Hidden transfers, extra instructions, changed
permissions and pre-signed packets are rejected.

The reviewed maximum network fee bounds the envelope's declared cap and encoded
priority fee. It is not an onchain total-fee cap: current base fees and blockhash
validity are still determined by the network, and the wallet presents the actual
transaction fee before approval. A returned wallet signature is checked against
the exact reviewed message. An unverified receipt produces an explicit status-
inspection error, with no automatic transaction retry.

Tests reconstruct native SDK-built arm/revoke transactions, including optional
recipient ATA allocation, and reject tampered variants. A labelled Wallet Standard
fixture produces real message signatures and executes actual owner-signed arm and
revoke transactions against the local guard/token programs. It is not a mainnet
wallet extension or transaction demonstration.

A separate Playwright test bundles the public entry for a browser and executes
validation in Chromium with no global Node Buffer. That test exposed spl-token
0.4.15's ATA helper reference to an unimported global Buffer. The browser validator
now encodes that small canonical idempotent ATA instruction directly, using an
explicit buffer import; native SDK-built messages remain its independent reference.
Shared pure codec helpers also import their buffer dependency explicitly. No
algorithm is monkey-patched and no global Node environment is supplied to Chromium.

Browser test setup is project-local:

```sh
PLAYWRIGHT_BROWSERS_PATH=.tools/playwright bun x --no-install playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=.tools/playwright SOLSTOCK_SNAPSHOT=<local-fixtures>/snapshot.json bun test tests/_13_wallet
```

The installed browser is Playwright Chromium 1243 / Chrome for Testing
153.0.8010.12. The tests close browser/server processes before returning. UI
screenshots and the complete local connect/preview/arm/return/revoke browser
journey are documented in documents 20–22. The mainnet journey remains unfinished.
