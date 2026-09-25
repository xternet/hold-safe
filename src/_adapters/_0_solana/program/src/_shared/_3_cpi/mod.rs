use super::Route;
use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};

pub fn swap<'info>(
    policy: &AccountInfo<'info>,
    staging: &AccountInfo<'info>,
    recipient: &AccountInfo<'info>,
    r: &Route<'info>,
    memo: &AccountInfo<'info>,
    remaining: &[AccountInfo<'info>],
    amount: u64,
    minimum: u64,
    seeds: &[&[u8]],
) -> Result<()> {
    let mut accounts = vec![
        policy.clone(),
        r.config.to_account_info(),
        r.pool.to_account_info(),
        staging.clone(),
        recipient.clone(),
        r.input_vault.to_account_info(),
        r.output_vault.to_account_info(),
        r.observation.to_account_info(),
        r.output_program.to_account_info(),
        r.input_program.to_account_info(),
        memo.clone(),
        r.input_mint.to_account_info(),
        r.output_mint.to_account_info(),
    ];
    accounts.extend_from_slice(remaining);
    let mut data = vec![43, 4, 237, 11, 26, 201, 30, 98]; // Raydium swap_v2.
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&minimum.to_le_bytes());
    data.extend_from_slice(&0u128.to_le_bytes()); // Native default sqrt-price bound.
    data.push(1); // Exact input, never keeper-selected instruction data.
    let instruction = Instruction {
        program_id: r.dex.key(),
        data,
        accounts: accounts
            .iter()
            .enumerate()
            .map(|(index, account)| AccountMeta {
                pubkey: *account.key,
                is_signer: index == 0,
                is_writable: matches!(index, 2..=7) || index >= 13,
            })
            .collect(),
    };
    accounts.push(r.dex.to_account_info());
    invoke_signed(&instruction, &accounts, &[seeds])?;
    Ok(())
}
