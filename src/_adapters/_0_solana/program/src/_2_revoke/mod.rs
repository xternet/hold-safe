use crate::_shared::*;
use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::token_2022::{revoke as revoke_token, Revoke as TokenRevoke};

#[derive(Accounts)]
pub struct Revoke<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner @ GuardError::InvalidAccount,
        seeds = [b"policy", policy.owner.as_ref(), &policy.order_id], bump = policy.bump)]
    pub policy: Account<'info, Policy>,
    /// CHECK: exact policy source, token owner and delegate validated in handler.
    #[account(mut, address = policy.source @ GuardError::InvalidAccount)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: canonical executable program, also pinned by policy.
    #[account(address = anchor_spl::token_2022::ID @ GuardError::InvalidAccount, executable)]
    pub input_program: UncheckedAccount<'info>,
}

pub fn revoke(ctx: Context<Revoke>) -> Result<()> {
    let a = ctx.accounts;
    require!(a.policy.state == ACTIVE, GuardError::InactivePolicy);
    require_keys_eq!(
        a.input_program.key(),
        a.policy.route[2],
        GuardError::InvalidAccount
    );
    // Revocation remains possible when the mint is paused or the account frozen:
    // SPL revoke itself does not require transferring tokens.
    require_keys_eq!(
        *a.source.owner,
        a.input_program.key(),
        GuardError::InvalidAccount
    );
    use anchor_spl::token_2022::spl_token_2022::{
        extension::StateWithExtensions, state::Account as TokenAccount,
    };
    let bytes = a.source.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccount>::unpack(&bytes)?.base;
    drop(bytes);
    if state.owner == a.owner.key() && state.delegate == COption::Some(a.policy.key()) {
        revoke_token(CpiContext::new(
            a.input_program.to_account_info(),
            TokenRevoke {
                source: a.source.to_account_info(),
                authority: a.owner.to_account_info(),
            },
        ))?;
    } else {
        msg!(
            "SOURCE_APPROVAL_CHANGED {}; policy cancellation still applies",
            a.source.key()
        );
    }
    a.policy.state = REVOKED;
    msg!("POLICY_REVOKED {}", a.policy.key());
    Ok(())
}
