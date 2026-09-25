# Third-party components

HoldSafe uses the dependencies pinned in package.json and bun.lock. Their own
licenses remain applicable; package names here do not imply sponsorship.

- Solana web3.js, SPL Token, Solana Kit and Wallet Standard: chain, token and wallet APIs.
- Raydium SDK v2 and its CLMM Devnet program: pool state, quote math and swap construction.
- Bun and SQLite: application runtime and durable demo journal.
- React, Vite and TypeScript: application and build tooling.
- LiteSVM and Playwright: native permission and browser verification.
- BN.js, decimal.js and noble hashes: arithmetic and hashing dependencies.
- Solflare: external wallet used by the demo; not bundled as a wallet service.
- Alpaca: optional informational IEX market data; not the simulated exit reference.

Dependency license texts are distributed with their installed packages. Native
program IDs and route bindings are documented in the source and demo evidence.
No third-party private keys or API credentials belong in a public checkout.

Project license: not yet selected by the owner. No blanket open-source license
is asserted for this review; dependency licensing is unchanged.
