use crate::_shared::*;
use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::token_2022::{approve_checked, ApproveChecked};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AuthorizeArgs {
    pub order_id: [u8; 32],
    pub policy_hash: [u8; 32],
    pub domain: Pubkey,
    pub version: u8,
    pub amount: u64,
    pub minimum_output: u64,
    pub expires_at: i64,
    pub replace_delegate: bool,
}

#[derive(Accounts)]
#[instruction(args: AuthorizeArgs)]
pub struct Authorize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Policy::INIT_SPACE,
        seeds = [b"policy", owner.key().as_ref(), &args.order_id], bump)]
    pub policy: Account<'info, Policy>,
    /// CHECK: owner chooses keeper; non-default checked, execution needs signature.
    pub keeper: UncheckedAccount<'info>,
    /// CHECK: token program, mint, state, owner and delegate checked in handler.
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: policy-owned token account, mint, delegate and close authority checked.
    pub staging: UncheckedAccount<'info>,
    /// CHECK: owner-owned output token account validated in handler.
    pub recipient: UncheckedAccount<'info>,
    pub route: Route<'info>,
    pub system_program: Program<'info, System>,
}

pub fn authorize(ctx: Context<Authorize>, args: AuthorizeArgs) -> Result<()> {
    let a = ctx.accounts;
    require!(
        args.domain == NETWORK && args.version == 1,
        GuardError::InvalidDomain
    );
    require!(
        args.amount > 0
            && args.minimum_output > 0
            && args.expires_at > Clock::get()?.unix_timestamp
            && args.order_id != [0; 32]
            && args.policy_hash != [0; 32],
        GuardError::InvalidBounds
    );
    require!(
        a.keeper.key() != Pubkey::default(),
        GuardError::InvalidAccount
    );
    let decimals = a.route.validate()?;
    let source = token(
        &a.source,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &a.owner.key(),
    )?;
    let staging = token(
        &a.staging,
        &a.route.input_program.key(),
        &a.route.input_mint.key(),
        &a.policy.key(),
    )?;
    token(
        &a.recipient,
        &a.route.output_program.key(),
        &a.route.output_mint.key(),
        &a.owner.key(),
    )?;
    require!(source.amount >= args.amount, GuardError::InvalidBounds);
    require!(
        source.delegate == COption::None || args.replace_delegate,
        GuardError::DelegateReplacementRequired
    );
    require!(
        staging.delegate == COption::None && staging.close_authority == COption::None,
        GuardError::InvalidAccount
    );
    let unique = [
        a.source.key(),
        a.staging.key(),
        a.recipient.key(),
        a.route.input_vault.key(),
        a.route.output_vault.key(),
    ];
    for (index, key) in unique.iter().enumerate() {
        require!(!unique[..index].contains(key), GuardError::InvalidAccount);
    }
    a.policy.set_inner(Policy {
        version: 1,
        state: ACTIVE,
        bump: ctx.bumps.policy,
        owner: a.owner.key(),
        keeper: a.keeper.key(),
        source: a.source.key(),
        staging: a.staging.key(),
        recipient: a.recipient.key(),
        order_id: args.order_id,
        policy_hash: args.policy_hash,
        amount: args.amount,
        minimum_output: args.minimum_output,
        expires_at: args.expires_at,
        route: a.route.keys(),
    });
    approve_checked(
        CpiContext::new(
            a.route.input_program.to_account_info(),
            ApproveChecked {
                to: a.source.to_account_info(),
                mint: a.route.input_mint.to_account_info(),
                delegate: a.policy.to_account_info(),
                authority: a.owner.to_account_info(),
            },
        ),
        args.amount,
        decimals,
    )?;
    msg!(
        "POLICY_ARMED {} amount={} floor={} expiry={}",
        a.policy.key(),
        args.amount,
        args.minimum_output,
        args.expires_at
    );
    Ok(())
}
