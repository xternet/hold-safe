use crate::_shared::{_3_cpi, *};
use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::token_2022::{transfer_checked, TransferChecked};

#[derive(Accounts)]
pub struct Execute<'info> {
    pub keeper: Signer<'info>,
    #[account(mut, has_one = keeper @ GuardError::InvalidAccount,
        seeds = [b"policy", policy.owner.as_ref(), &policy.order_id], bump = policy.bump)]
    pub policy: Account<'info, Policy>,
    /// CHECK: exact policy key plus native token validation.
    #[account(mut, address = policy.source @ GuardError::InvalidAccount)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: exact policy key plus native token validation.
    #[account(mut, address = policy.staging @ GuardError::InvalidAccount)]
    pub staging: UncheckedAccount<'info>,
    /// CHECK: exact policy key plus native token validation.
    #[account(mut, address = policy.recipient @ GuardError::InvalidAccount)]
    pub recipient: UncheckedAccount<'info>,
    pub route: Route<'info>,
    /// CHECK: canonical executable memo program required by swap_v2.
    #[account(address = MEMO @ GuardError::InvalidAccount, executable)]
    pub memo: UncheckedAccount<'info>,
}

pub fn execute<'info>(
    ctx: Context<'_, '_, '_, 'info, Execute<'info>>,
    quoted_minimum: u64,
) -> Result<()> {
    let a = ctx.accounts;
    require!(
        a.policy.version == 1 && a.policy.state == ACTIVE,
        GuardError::InactivePolicy
    );
    require!(
        Clock::get()?.unix_timestamp < a.policy.expires_at,
        GuardError::ExpiredPolicy
    );
    require!(a.route.keys() == a.policy.route, GuardError::InvalidRoute);
    let decimals = a.route.validate()?;
    let source = token(
        &a.source,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &a.policy.owner,
    )?;
    let staging = token(
        &a.staging,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &a.policy.key(),
    )?;
    let output = token(
        &a.recipient,
        &a.route.output_program.key(),
        &a.route.output_mint.key(),
        &a.policy.owner,
    )?;
    require!(
        source.delegate == COption::Some(a.policy.key())
            && source.delegated_amount >= a.policy.amount,
        GuardError::InvalidDelegate
    );
    require!(
        source.amount >= a.policy.amount
            && staging.delegate == COption::None
            && staging.close_authority == COption::None,
        GuardError::InvalidAccount
    );
    let mut forbidden = a.route.keys().to_vec();
    forbidden.extend_from_slice(&[
        a.policy.key(),
        a.source.key(),
        a.staging.key(),
        a.recipient.key(),
        a.keeper.key(),
    ]);
    ticks(&a.route.pool.key(), ctx.remaining_accounts, &forbidden)?;
    let minimum = a.policy.minimum_output.max(quoted_minimum);
    let amount = a.policy.amount;
    let bump = [a.policy.bump];
    let owner = a.policy.owner;
    let order = a.policy.order_id;
    let seeds: &[&[u8]] = &[b"policy", owner.as_ref(), &order, &bump];
    // Write before CPI for reentrancy defense; any failure rolls state back.
    a.policy.state = CONSUMED;
    a.policy.exit(&crate::ID)?;
    transfer_checked(
        CpiContext::new_with_signer(
            a.route.input_program.to_account_info(),
            TransferChecked {
                from: a.source.to_account_info(),
                mint: a.route.input_mint.to_account_info(),
                to: a.staging.to_account_info(),
                authority: a.policy.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        decimals,
    )?;
    _3_cpi::swap(
        &a.policy.to_account_info(),
        &a.staging,
        &a.recipient,
        &a.route,
        &a.memo,
        ctx.remaining_accounts,
        amount,
        minimum,
        seeds,
    )?;
    let source_after = token(
        &a.source,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &owner,
    )?;
    let stage_after = token(
        &a.staging,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &a.policy.key(),
    )?;
    let output_after = token(
        &a.recipient,
        &a.route.output_program.key(),
        &a.route.output_mint.key(),
        &owner,
    )?;
    require!(
        source.amount.checked_sub(source_after.amount) == Some(amount)
            && stage_after.amount == staging.amount,
        GuardError::InvalidDelta
    );
    let received = output_after
        .amount
        .checked_sub(output.amount)
        .ok_or(GuardError::InvalidDelta)?;
    require!(received >= minimum, GuardError::BelowFloor);
    msg!(
        "POLICY_CONSUMED {} input={} output={}",
        a.policy.key(),
        amount,
        received
    );
    Ok(())
}
