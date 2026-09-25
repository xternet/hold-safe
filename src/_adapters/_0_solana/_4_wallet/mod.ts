// Browser-safe entry: no server adapter, credentials, storage or runtime stages.
export { validateOwnerTransaction, type OwnerReview } from "./_0_validate/mod";
export { connectWallet, supportedWallet, watchWallets, type ConnectedWallet } from "./_1_connection/mod";
export type { Wallet as BrowserWallet } from "@wallet-standard/base";
export { validateDemoTransaction } from "./_2_demo/mod";
