export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
// Issuer API and Raydium pair discovery verified in M01; native checks follow.
export const INPUT_MINT = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
export const OUTPUT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const POOL = "CKwJZwm7oj3nu4653N1EpDrqXbXAYXoPFiPeEnLouF8y";
export const DEX = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
export const PROBE_SEED = "m01-authority-probe";
export type CapturedAccount = {
  address: string; owner: string; lamports: number; executable: boolean;
  data: string; sha256: string;
};
export type Snapshot = {
  schema: 1; genesis: string; capturedAt: string; slot: number;
  pool: string; ticks: string[]; accounts: CapturedAccount[];
  programs: { address: string; file: string; sha256: string; slot: number }[];
};
export type RouteCase = { mode: "owner" | "delegate" | "pda"; allowance?: bigint; floor?: bigint };
