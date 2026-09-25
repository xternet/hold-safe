use anchor_lang::prelude::*;

pub const ACTIVE: u8 = 1;
pub const CONSUMED: u8 = 2;
pub const REVOKED: u8 = 3;
#[cfg(not(feature = "devnet-demo"))]
pub const NETWORK: Pubkey = pubkey!("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
#[cfg(not(feature = "devnet-demo"))]
pub const DEX: Pubkey = pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
#[cfg(feature = "devnet-demo")]
pub const NETWORK: Pubkey = pubkey!("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
#[cfg(feature = "devnet-demo")]
pub const DEX: Pubkey = pubkey!("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH");
pub const MEMO: Pubkey = pubkey!("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub version: u8,
    pub state: u8,
    pub bump: u8,
    pub owner: Pubkey,
    pub keeper: Pubkey,
    pub source: Pubkey,
    pub staging: Pubkey,
    pub recipient: Pubkey,
    pub order_id: [u8; 32],
    pub policy_hash: [u8; 32],
    pub amount: u64,
    pub minimum_output: u64,
    pub expires_at: i64,
    // input/output mint, input/output token program, DEX, pool, config,
    // input/output vault, observation. Position and meaning are schema v1.
    pub route: [Pubkey; 10],
}

#[error_code]
pub enum GuardError {
    #[msg("Policy has already been consumed or revoked")]
    InactivePolicy,
    #[msg("Policy expiry reached")]
    ExpiredPolicy,
    #[msg("Unsupported policy domain or schema/rule version")]
    InvalidDomain,
    #[msg("Invalid amount, floor, expiry, digest or order")]
    InvalidBounds,
    #[msg("Account identity, authority or program does not match policy")]
    InvalidAccount,
    #[msg("Route account or tick does not belong to the selected CLMM pool")]
    InvalidRoute,
    #[msg("Unknown or unsafe token extension/state")]
    UnsupportedToken,
    #[msg("Source has an existing delegate; explicit owner replacement required")]
    DelegateReplacementRequired,
    #[msg("Policy is not the source's authorized delegate for the full amount")]
    InvalidDelegate,
    #[msg("Native token balance changes violate the authorization")]
    InvalidDelta,
    #[msg("Proceeds do not meet the user-authorized floor")]
    BelowFloor,
    #[msg("Corporate action window or unsupported adjustment schedule")]
    CorporateActionWindow,
}
