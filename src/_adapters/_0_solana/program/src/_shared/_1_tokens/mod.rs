use super::GuardError;
use anchor_lang::{prelude::*, solana_program::program_option::COption};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        confidential_transfer::ConfidentialTransferMint,
        default_account_state::DefaultAccountState,
        pausable::PausableConfig,
        scaled_ui_amount::ScaledUiAmountConfig,
        transfer_hook::{TransferHook, TransferHookAccount},
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    state::{Account as TokenAccount, AccountState, Mint},
};

pub fn mint(account: &AccountInfo, program: &Pubkey, extended: bool) -> Result<Mint> {
    require_keys_eq!(*account.owner, *program, GuardError::InvalidAccount);
    let data = account.try_borrow_data()?;
    let state = StateWithExtensions::<Mint>::unpack(&data)?;
    require!(state.base.is_initialized, GuardError::UnsupportedToken);
    let extensions = state.get_extension_types()?;
    if !extended {
        require!(
            extensions.is_empty() && data.len() == 82,
            GuardError::UnsupportedToken
        );
    }
    for extension in extensions {
        match extension {
            ExtensionType::MetadataPointer
            | ExtensionType::TokenMetadata
            | ExtensionType::PermanentDelegate => {}
            ExtensionType::DefaultAccountState => {
                let value = state.get_extension::<DefaultAccountState>()?;
                require!(
                    value.state == AccountState::Initialized as u8,
                    GuardError::UnsupportedToken
                );
            }
            ExtensionType::Pausable => {
                require!(
                    !bool::from(state.get_extension::<PausableConfig>()?.paused),
                    GuardError::UnsupportedToken
                );
            }
            ExtensionType::TransferHook => {
                let hook = state.get_extension::<TransferHook>()?;
                require!(
                    Option::<Pubkey>::from(hook.program_id).is_none(),
                    GuardError::UnsupportedToken
                );
            }
            ExtensionType::ConfidentialTransferMint => {
                let config = state.get_extension::<ConfidentialTransferMint>()?;
                require!(
                    !bool::from(config.auto_approve_new_accounts),
                    GuardError::UnsupportedToken
                );
            }
            ExtensionType::ScaledUiAmount => {
                let config = state.get_extension::<ScaledUiAmountConfig>()?;
                let current: f64 = config.multiplier.into();
                let next: f64 = config.new_multiplier.into();
                require!(
                    current.is_finite() && current > 0.0 && next.is_finite() && next > 0.0,
                    GuardError::UnsupportedToken
                );
                if current != next {
                    let activation: i64 = config.new_multiplier_effective_timestamp.into();
                    require!(
                        activation > 0 && activation % 86_400 == 1_800
                            && activation <= i64::MAX - 300,
                        GuardError::CorporateActionWindow
                    );
                    // xStocks ex-date through activation plus five-minute operational buffer.
                    let now = Clock::get()?.unix_timestamp;
                    require!(
                        now < activation - 88_200 || now >= activation + 300,
                        GuardError::CorporateActionWindow
                    );
                }
            }
            _ => return err!(GuardError::UnsupportedToken),
        }
    }
    Ok(state.base)
}

pub fn token(
    account: &AccountInfo,
    program: &Pubkey,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Result<TokenAccount> {
    require_keys_eq!(*account.owner, *program, GuardError::InvalidAccount);
    let data = account.try_borrow_data()?;
    let state = StateWithExtensions::<TokenAccount>::unpack(&data)?;
    require_keys_eq!(state.base.mint, *mint, GuardError::InvalidAccount);
    require_keys_eq!(state.base.owner, *owner, GuardError::InvalidAccount);
    require!(
        state.base.state == AccountState::Initialized && state.base.is_native == COption::None,
        GuardError::UnsupportedToken
    );
    for extension in state.get_extension_types()? {
        match extension {
            ExtensionType::ImmutableOwner | ExtensionType::PausableAccount => {}
            ExtensionType::TransferHookAccount => {
                require!(
                    !bool::from(state.get_extension::<TransferHookAccount>()?.transferring),
                    GuardError::UnsupportedToken
                );
            }
            _ => return err!(GuardError::UnsupportedToken),
        }
    }
    Ok(state.base)
}
