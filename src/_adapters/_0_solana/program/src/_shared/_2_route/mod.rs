use super::{mint, token, GuardError, DEX};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Route<'info> {
    /// CHECK: validated mint owner, state and extension profile.
    pub input_mint: UncheckedAccount<'info>,
    /// CHECK: validated classic mint, no extensions.
    pub output_mint: UncheckedAccount<'info>,
    /// CHECK: canonical executable Token-2022 program.
    pub input_program: UncheckedAccount<'info>,
    /// CHECK: canonical executable SPL Token program.
    pub output_program: UncheckedAccount<'info>,
    /// CHECK: canonical executable Raydium CLMM program.
    pub dex: UncheckedAccount<'info>,
    /// CHECK: program-owned pool with validated native layout.
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    /// CHECK: program-owned config matched against the pool.
    pub config: UncheckedAccount<'info>,
    /// CHECK: token vault matched against pool, mint and pool authority.
    #[account(mut)]
    pub input_vault: UncheckedAccount<'info>,
    /// CHECK: token vault matched against pool, mint and pool authority.
    #[account(mut)]
    pub output_vault: UncheckedAccount<'info>,
    /// CHECK: program-owned observation matched against the pool.
    #[account(mut)]
    pub observation: UncheckedAccount<'info>,
}

impl Route<'_> {
    pub fn keys(&self) -> [Pubkey; 10] {
        [
            self.input_mint.key(),
            self.output_mint.key(),
            self.input_program.key(),
            self.output_program.key(),
            self.dex.key(),
            self.pool.key(),
            self.config.key(),
            self.input_vault.key(),
            self.output_vault.key(),
            self.observation.key(),
        ]
    }
    pub fn validate(&self) -> Result<u8> {
        for (program, expected) in [
            (&self.input_program, anchor_spl::token_2022::ID),
            (&self.output_program, anchor_spl::token::ID),
            (&self.dex, DEX),
        ] {
            require_keys_eq!(program.key(), expected, GuardError::InvalidAccount);
            require!(program.executable, GuardError::InvalidAccount);
        }
        let input = mint(&self.input_mint, &self.input_program.key(), true)?;
        let output = mint(&self.output_mint, &self.output_program.key(), false)?;
        require_keys_neq!(
            self.input_mint.key(),
            self.output_mint.key(),
            GuardError::InvalidRoute
        );
        for account in [&self.pool, &self.config, &self.observation] {
            require_keys_eq!(*account.owner, DEX, GuardError::InvalidRoute);
        }
        let data = self.pool.try_borrow_data()?;
        // Official PoolState v1 layout; Anchor discriminator plus one-byte bump.
        require!(
            data.len() >= 235 && data[..8] == [247, 237, 227, 245, 215, 195, 222, 70],
            GuardError::InvalidRoute
        );
        require_keys_eq!(
            read_key(&data, 9)?,
            self.config.key(),
            GuardError::InvalidRoute
        );
        let a_to_b = read_key(&data, 73)? == self.input_mint.key();
        let (im, om, iv, ov, idec, odec) = if a_to_b {
            (73, 105, 137, 169, 233, 234)
        } else {
            (105, 73, 169, 137, 234, 233)
        };
        for (offset, expected) in [
            (im, self.input_mint.key()),
            (om, self.output_mint.key()),
            (iv, self.input_vault.key()),
            (ov, self.output_vault.key()),
            (201, self.observation.key()),
        ] {
            require_keys_eq!(read_key(&data, offset)?, expected, GuardError::InvalidRoute);
        }
        require!(
            data[idec] == input.decimals && data[odec] == output.decimals,
            GuardError::InvalidRoute
        );
        token(
            &self.input_vault,
            &self.input_program.key(),
            &self.input_mint.key(),
            &self.pool.key(),
        )?;
        token(
            &self.output_vault,
            &self.output_program.key(),
            &self.output_mint.key(),
            &self.pool.key(),
        )?;
        Ok(input.decimals)
    }
}

pub fn read_key(data: &[u8], offset: usize) -> Result<Pubkey> {
    let bytes: [u8; 32] = data
        .get(offset..offset + 32)
        .ok_or(GuardError::InvalidRoute)?
        .try_into()
        .map_err(|_| GuardError::InvalidRoute)?;
    Ok(Pubkey::new_from_array(bytes))
}

pub fn ticks(pool: &Pubkey, accounts: &[AccountInfo], forbidden: &[Pubkey]) -> Result<()> {
    require!((2..=7).contains(&accounts.len()), GuardError::InvalidRoute);
    let bitmap =
        Pubkey::find_program_address(&[b"pool_tick_array_bitmap_extension", pool.as_ref()], &DEX).0;
    require_keys_eq!(*accounts[0].key, bitmap, GuardError::InvalidRoute);
    for (index, account) in accounts.iter().enumerate() {
        require_keys_eq!(*account.owner, DEX, GuardError::InvalidRoute);
        require!(
            !account.is_signer && account.is_writable,
            GuardError::InvalidRoute
        );
        require!(
            !forbidden.contains(account.key)
                && !accounts[..index].iter().any(|a| a.key == account.key),
            GuardError::InvalidRoute
        );
        let data = account.try_borrow_data()?;
        require_keys_eq!(read_key(&data, 8)?, *pool, GuardError::InvalidRoute);
        if index > 0 {
            require!(
                data[..8] == [192, 155, 85, 205, 49, 249, 129, 42],
                GuardError::InvalidRoute
            );
        }
    }
    Ok(())
}
