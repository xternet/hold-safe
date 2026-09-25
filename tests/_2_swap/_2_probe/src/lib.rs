//! Test-only CPI probe. Never deploy this program.
mod _0_stage;
use _0_stage::probe;
use solana_program::entrypoint;
entrypoint!(probe);
