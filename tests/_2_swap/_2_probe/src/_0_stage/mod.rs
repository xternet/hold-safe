//! LOCAL TEST PROBE ONLY. No policy/owner authentication: never deploy this.
//! Tests actual delegated Token-2022 transfer -> PDA-owned CLMM input -> swap.
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
};

pub fn probe(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if accounts.len() < 16 || data.len() != 41 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let source = &accounts[0];
    let swap_accounts = &accounts[1..accounts.len() - 1];
    let dex = &accounts[accounts.len() - 1];
    let (pda, bump) = Pubkey::find_program_address(&[b"m01-authority-probe"], program_id);
    if *dex.key != pubkey!("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
        || *swap_accounts[0].key != pda
        || *swap_accounts[9].key != pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
    {
        return Err(ProgramError::IncorrectProgramId);
    }
    // Raydium's documented swap_v2 discriminator; exact-input only.
    if data[..8] != [43, 4, 237, 11, 26, 201, 30, 98] || data[40] != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mint_data = swap_accounts[11].try_borrow_data()?;
    let decimals = *mint_data.get(44).ok_or(ProgramError::InvalidAccountData)?;
    drop(mint_data);
    let mut transfer_data = vec![12]; // SPL Token TransferChecked opcode.
    transfer_data.extend_from_slice(&data[8..16]);
    transfer_data.push(decimals);
    let transfer = Instruction {
        program_id: *swap_accounts[9].key,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*swap_accounts[11].key, false),
            AccountMeta::new(*swap_accounts[3].key, false),
            AccountMeta::new_readonly(pda, true),
        ],
        data: transfer_data,
    };
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[b"m01-authority-probe", &bump_seed];
    invoke_signed(
        &transfer,
        &[
            source.clone(),
            swap_accounts[11].clone(),
            swap_accounts[3].clone(),
            swap_accounts[0].clone(),
            swap_accounts[9].clone(),
        ],
        &[seeds],
    )?;
    let swap = Instruction {
        program_id: *dex.key,
        accounts: swap_accounts
            .iter()
            .map(|account| AccountMeta {
                pubkey: *account.key,
                is_writable: account.is_writable,
                is_signer: *account.key == pda,
            })
            .collect(),
        data: data.to_vec(),
    };
    invoke_signed(&swap, &accounts[1..], &[seeds])
}
