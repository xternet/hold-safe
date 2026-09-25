use anchor_lang::prelude::*;
mod _0_authorize;
mod _1_execute;
mod _2_revoke;
mod _shared;
use _0_authorize::*;
use _1_execute::*;
use _2_revoke::*;

#[cfg(not(feature = "devnet-demo"))]
declare_id!("HNpQ9dn9Prr97FrQQoU3auhRgHiAsCWwsTy45kde9yvL");
#[cfg(feature = "devnet-demo")]
declare_id!("Az4M4V4fFC2ZxNb3SwbSmWWKmXD66HhCFmaduKJDqcA4");

#[program]
pub mod solstock_guard {
    use super::*;
    pub fn authorize(ctx: Context<Authorize>, args: AuthorizeArgs) -> Result<()> {
        _0_authorize::authorize(ctx, args)
    }
    pub fn execute<'info>(
        ctx: Context<'_, '_, '_, 'info, Execute<'info>>,
        quoted_minimum: u64,
    ) -> Result<()> {
        _1_execute::execute(ctx, quoted_minimum)
    }
    pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
        _2_revoke::revoke(ctx)
    }
}
