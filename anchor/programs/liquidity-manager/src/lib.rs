use anchor_lang::{prelude::*};
use anchor_spl::{
    associated_token::AssociatedToken, memo::Memo, token::{Mint, Token, TokenAccount}};
use anchor_lang::solana_program::account_info::AccountInfo;

use raydium_clmm_cpi::{cpi::accounts::DecreaseLiquidityV2};
use raydium_clmm_cpi::cpi::accounts::IncreaseLiquidityV2;

pub const RAYDIUM_CLMM_PROGRAM_ID: Pubkey = pubkey!("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxg27EAtH");

declare_id!("FB2bC1eV24WNFyJUziFHgfvCNFeReDtuvqpkuY457tAW");

#[program]
pub mod liquidity_manager {
    use super::*;

    // Initializes the manager with a Raydium pool and token vaults
    pub fn initialize(
        ctx: Context<Initialize>,
        lower_tick: i32,
        upper_tick: i32,
        executor: Pubkey,
    ) -> Result<()> {
        let manager = &mut ctx.accounts.manager;
        manager.authority = *ctx.accounts.authority.key;
        manager.pool = ctx.accounts.pool.key();
        manager.token_mint_a = ctx.accounts.token_mint_a.key(); 
        manager.token_mint_b = ctx.accounts.token_mint_b.key(); 
        manager.token_vault_a = ctx.accounts.token_vault_a.key(); 
        manager.token_vault_b = ctx.accounts.token_vault_b.key(); 
        manager.lower_tick = lower_tick;
        manager.upper_tick = upper_tick;
        manager.executor = executor;
        manager.current_liquidity = 0; 
        
        // Token vaults are automatically created by Anchor via #[account(init)]
        msg!(
            "Manager initialized for pool: {}. Vault A: {}, Vault B: {}",
            manager.pool,
            ctx.accounts.token_vault_a.key(),
            ctx.accounts.token_vault_b.key()
        );
        Ok(())
    }
    
    pub fn remove_liquidity(ctx: Context<RemoveLiquidity>) -> Result<()> {
        let current_liquidity = {
            let position_data_bytes = ctx.accounts.personal_position.try_borrow_data()?;
            msg!("Account length: {}", position_data_bytes.len());
        
            let data = &position_data_bytes[8..];
            let liquidity_bytes = &data[73..89];
            let current_liquidity = u128::from_le_bytes(
                liquidity_bytes
                    .try_into()
                    .map_err(|_| anchor_lang::error!(LiquidityManagerError::InvalidAccountData))?,
            );
            msg!("Manually extracted liquidity: {}", current_liquidity);
            current_liquidity
        };
        
        msg!("Removing liquidity: {}", current_liquidity);
    
        let cpi_accounts = DecreaseLiquidityV2 {
            nft_owner: ctx.accounts.nft_owner.to_account_info(),
            nft_account: ctx.accounts.nft_account.clone(),
            pool_state: ctx.accounts.pool_state.clone(),
            protocol_position: ctx.accounts.protocol_position.clone(),
            personal_position: ctx.accounts.personal_position.clone(),
            tick_array_lower: ctx.accounts.tick_array_lower.clone(),
            tick_array_upper: ctx.accounts.tick_array_upper.clone(),
            recipient_token_account_0: ctx.accounts.token_account_0.to_account_info(),
            recipient_token_account_1: ctx.accounts.token_account_1.to_account_info(),
            token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            vault_0_mint: ctx.accounts.vault_0_mint.clone(),
            vault_1_mint: ctx.accounts.vault_1_mint.clone(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
        };
    
        let cpi_ctx = CpiContext::new(ctx.accounts.raydium_program.clone(), cpi_accounts);
    
        msg!("Ready to decrease Liquidity");
    
        raydium_clmm_cpi::cpi::decrease_liquidity_v2(
            cpi_ctx,
            current_liquidity,
            0, // min_token_a
            0, // min_token_b
        )?;
    
        ctx.accounts.manager.current_liquidity = current_liquidity;
    
        Ok(())
    }

    pub fn swap<'info>(
        ctx: Context<'_, '_, 'info, 'info, Swap<'info>>,
        amount_in: u64,
    ) -> Result<()> {
        //  DO NOT read or clone these accounts outside the CPI
        let cpi_accounts = raydium_clmm_cpi::cpi::accounts::SwapSingleV2 {
            payer: ctx.accounts.payer.to_account_info(),
            amm_config: ctx.accounts.amm_config.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            input_token_account: ctx.accounts.input_token_account.to_account_info(),
            output_token_account: ctx.accounts.output_token_account.to_account_info(),
            input_vault: ctx.accounts.input_vault.to_account_info(),
            output_vault: ctx.accounts.output_vault.to_account_info(),
            observation_state: ctx.accounts.observation_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
            input_vault_mint: ctx.accounts.input_vault_mint.to_account_info(),
            output_vault_mint: ctx.accounts.output_vault_mint.to_account_info(),
        };
    
        let cpi_ctx = CpiContext::new(
            ctx.accounts.raydium_program.to_account_info(),
            cpi_accounts,
        ).with_remaining_accounts(ctx.remaining_accounts.to_vec());
    
        msg!("about to call CPI");

        msg!("payer {}", ctx.accounts.payer.key());
        msg!("pool_state {}", ctx.accounts.pool_state.key());
        msg!("input_token_account {}", ctx.accounts.input_token_account.key());
        msg!("output_token_account {}", ctx.accounts.output_token_account.key());
        msg!("input_vault {}", ctx.accounts.input_vault.key());
        msg!("output_vault {}", ctx.accounts.output_vault.key());
        msg!("observation_state {}", ctx.accounts.observation_state.key());
        msg!("remaining accounts:");
        for acc in ctx.remaining_accounts.iter() {
            msg!(" - {}", acc.key());
        }   

        raydium_clmm_cpi::cpi::swap_v2(
            cpi_ctx,
            amount_in,
            0,
            0,
            true,
        )?;
    
        Ok(())
    }
     
    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
    ) -> Result<()> {
        let liquidity_amount = ctx.accounts.manager.current_liquidity;
    
        let token_a_amount = ctx.accounts.token_account_0.amount;
        let token_b_amount = ctx.accounts.token_account_1.amount;
    
        let token_a_max = token_a_amount.checked_mul(110).unwrap() / 100;
        let token_b_max = token_b_amount.checked_mul(110).unwrap() / 100;
    
        let cpi_accounts = IncreaseLiquidityV2 {
            nft_owner: ctx.accounts.nft_owner.to_account_info(),
            nft_account: ctx.accounts.nft_account.clone(),
            pool_state: ctx.accounts.pool_state.clone(),
            protocol_position: ctx.accounts.protocol_position.clone(),
            personal_position: ctx.accounts.personal_position.clone(),
            tick_array_lower: ctx.accounts.tick_array_lower.clone(),
            tick_array_upper: ctx.accounts.tick_array_upper.clone(),
            token_account_0: ctx.accounts.token_account_0.to_account_info(),
            token_account_1: ctx.accounts.token_account_1.to_account_info(),
            token_vault_0: ctx.accounts.token_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.token_vault_1.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            vault_0_mint: ctx.accounts.vault_0_mint.clone(),
            vault_1_mint: ctx.accounts.vault_1_mint.clone(),
        };
    
        let cpi_ctx = CpiContext::new(ctx.accounts.raydium_program.to_account_info(), cpi_accounts);
    
        raydium_clmm_cpi::cpi::increase_liquidity_v2(
            cpi_ctx,
            liquidity_amount,
            token_a_max,
            token_b_max,
            Some(true),
        )?;
    
        Ok(())
    }
    
    pub fn fund_vaults(ctx: Context<FundVaults>, amount_a: u64, amount_b: u64) -> Result<()> {
        // Transfer token A
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.payer_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount_a,
        )?;
    
        // Transfer token B
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.payer_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount_b,
        )?;
    
        Ok(())
    }
    pub fn store_new_position(ctx: Context<StoreNewPosition>, nft_mint: Pubkey, lower: i32, upper: i32) -> Result<()> {
        let manager = &mut ctx.accounts.manager;
        manager.position_nft_mint = nft_mint;
        manager.lower_tick = lower;
        manager.upper_tick = upper;
        Ok(())
    }
}

/*
// Maybe it is not needed
fn calculate_liquidity(
    lower_tick: i32,
    upper_tick: i32,
    amount_a: u64,
    amount_b: u64,
    current_tick: i32,
    token_a_decimals: u8,
    token_b_decimals: u8,
) -> Result<u128> {
    // 1. Convert ticks to sqrt prices
    let sqrt_price_lower = tick_to_sqrt_price(lower_tick)?;
    let sqrt_price_upper = tick_to_sqrt_price(upper_tick)?;
    let sqrt_price_current = tick_to_sqrt_price(current_tick)?;

    // 2. Adjust amounts for decimals
    let amount_a = adjust_for_decimals(amount_a, token_a_decimals)?;
    let amount_b = adjust_for_decimals(amount_b, token_b_decimals)?;

    // 3. Calculate liquidity based on position relative to current tick
    if current_tick < lower_tick {
        // Position is entirely in token B (right of range)
        Ok(calculate_liquidity_b(
            amount_b,
            sqrt_price_lower,
            sqrt_price_upper
        )?)
    } else if current_tick >= upper_tick {
        // Position is entirely in token A (left of range)
        Ok(calculate_liquidity_a(
            amount_a,
            sqrt_price_lower,
            sqrt_price_upper
        )?)
    } else {
        // Position is active (within range)
        Ok(std::cmp::min(
            calculate_liquidity_a(amount_a, sqrt_price_current, sqrt_price_upper)?,
            calculate_liquidity_b(amount_b, sqrt_price_lower, sqrt_price_current)?,
        ))
    }

}


/// Converts tick to sqrt price (Q64.64 fixed point)
fn tick_to_sqrt_price(tick: i32) -> Result<u128> {
    // Raydium uses Q64.64 fixed point sqrt price
    let sqrt_price = (1.0001f64.powi(tick)).sqrt();
    Ok((sqrt_price * (1u128 << 64) as f64) as u128)
}

/// Calculates liquidity when position is all token A
fn calculate_liquidity_a(amount_a: u128, sqrt_price_low: u128, sqrt_price_high: u128) -> Result<u128> {
    let sqrt_diff = sqrt_price_high.checked_sub(sqrt_price_low)
        .ok_or(LiquidityManagerError::InvalidTickRange)?;
    
    amount_a
        .checked_mul(sqrt_price_high)
        .and_then(|v| v.checked_mul(sqrt_price_low))
        .and_then(|v| v.checked_div(sqrt_diff))
        .ok_or(LiquidityManagerError::CalculationOverflow.into())
}

fn calculate_liquidity_b(amount_b: u128, sqrt_price_low: u128, sqrt_price_high: u128) -> Result<u128> {
    let sqrt_diff = sqrt_price_high.checked_sub(sqrt_price_low)
        .ok_or(LiquidityManagerError::InvalidTickRange)?;
    
    amount_b
        .checked_mul(1u128 << 64)
        .and_then(|v| v.checked_div(sqrt_diff))
        .ok_or(LiquidityManagerError::CalculationOverflow.into())
}

/// Adjusts token amount for decimals (convert to native units)
fn adjust_for_decimals(amount: u64, decimals: u8) -> Result<u128> {
    Ok(amount as u128 * 10u128.pow(decimals as u32))
}
 */


#[account]
pub struct LiquidityManager {
    pub authority: Pubkey,     // Admin wallet
    pub executor: Pubkey,      // Executor wallet (bot)
    pub pool: Pubkey,          // Raydium CL pool address
    pub token_mint_a: Pubkey,  // SOL mint
    pub token_mint_b: Pubkey,  // USDC mint
    pub token_vault_a: Pubkey, // Add this
    pub token_vault_b: Pubkey, // Add this
    pub lower_tick: i32,
    pub upper_tick: i32,
    pub current_liquidity: u128,
    pub position_nft_mint: Pubkey,
}

#[derive(Accounts)]
pub struct StoreNewPosition <'info>{
    #[account(mut)]
    pub manager: Account<'info, LiquidityManager>,
    pub authority: Signer<'info>,

}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + (32 * 8) + (4 * 2) + 16,
        seeds = [b"manager-v6", pool.key().as_ref()],
        bump
    )]
    pub manager: Account<'info, LiquidityManager>,
    // Token vaults
    #[account(
        init,
        payer = authority,
        associated_token::mint = token_mint_a,
        associated_token::authority = manager,
    )]
    pub token_vault_a: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = token_mint_b,
        associated_token::authority = manager,
    )]
    pub token_vault_b: Account<'info, TokenAccount>,
    
    // Raydium CL pool
    #[account(mut)]
    pub pool: AccountInfo<'info>,
    pub token_mint_a: Box<Account<'info, Mint>>,  // SOL
    pub token_mint_b: Box<Account<'info, Mint>>,  // USDC
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: AccountInfo<'info>,
    pub memo_program: Program<'info, Memo>,

    #[account(mut, has_one = executor)]
    pub manager: Account<'info, LiquidityManager>,
    pub executor: Signer<'info>,
    pub nft_owner: Signer<'info>,

    #[account(mut)]
    pub pool_state: AccountInfo<'info>,
    #[account(mut)]
    pub protocol_position: AccountInfo<'info>,
    #[account(mut)]
    pub personal_position: AccountInfo<'info>,
    #[account(mut)]
    pub nft_account: AccountInfo<'info>,

    #[account(mut)]
    pub tick_array_lower: AccountInfo<'info>,
    #[account(mut)]
    pub tick_array_upper: AccountInfo<'info>,

    #[account(mut)]
    pub token_account_0: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_account_1: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault_0: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault_1: Account<'info, TokenAccount>,

    pub vault_0_mint: AccountInfo<'info>,
    pub vault_1_mint: AccountInfo<'info>,

    pub raydium_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    pub payer: Signer<'info>,
    #[account(mut)]
    pub amm_config: AccountInfo<'info>,
    #[account(mut)]
    pub pool_state: AccountInfo<'info>,
    #[account(mut)]
    pub input_token_account: AccountInfo<'info>,
    #[account(mut)]
    pub output_token_account: AccountInfo<'info>,
    #[account(mut)]
    pub input_vault: AccountInfo<'info>,
    #[account(mut)]
    pub output_vault: AccountInfo<'info>,
    #[account(mut)]
    pub observation_state: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
    pub token_program_2022: AccountInfo<'info>,
    pub memo_program: AccountInfo<'info>,
    #[account()]
    pub input_vault_mint: AccountInfo<'info>,
    #[account()]
    pub output_vault_mint: AccountInfo<'info>,
    #[account(address = RAYDIUM_CLMM_PROGRAM_ID)]
    pub raydium_program: AccountInfo<'info>,
}
 
#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    pub token_program: Program<'info, Token>,
    pub token_program_2022: AccountInfo<'info>,

    #[account(mut, has_one = executor)]
    pub manager: Account<'info, LiquidityManager>,
    pub executor: Signer<'info>,
    pub nft_owner: Signer<'info>,

    #[account(mut)]
    pub pool_state: AccountInfo<'info>,
    #[account(mut)]
    pub protocol_position: AccountInfo<'info>,
    #[account(mut)]
    pub personal_position: AccountInfo<'info>,
    #[account(mut)]
    pub nft_account: AccountInfo<'info>,

    #[account(mut)]
    pub tick_array_lower: AccountInfo<'info>,
    #[account(mut)]
    pub tick_array_upper: AccountInfo<'info>,

    #[account(mut)]
    pub token_account_0: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_account_1: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault_0: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault_1: Account<'info, TokenAccount>,

    pub vault_0_mint: AccountInfo<'info>,
    pub vault_1_mint: AccountInfo<'info>,
    pub raydium_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct FundVaults<'info> {
    #[account(mut)]
    pub vault_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer_token_a: Account<'info, TokenAccount>,
    #[account(mut)]
    pub payer_token_b: Account<'info, TokenAccount>,
    #[account(mut)]
    pub mint_a: Account<'info, Mint>,
    #[account(mut)]
    pub mint_b: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Debug, Clone, Copy)]
pub struct RaydiumPoolState {
    pub status: u8,
    pub nonce: u8,
    pub current_tick: i32,  
}

#[error_code]
pub enum LiquidityManagerError {
    #[msg("Current tick is within range - no rebalance needed")]
    NoRebalanceNeeded,
    #[msg("Invalid executor")]
    InvalidExecutor,
    #[msg("The Pool Data is invalid")]
    InvalidPoolData,
    #[msg("")]
    CalculationOverflow,
    #[msg("No Account Found")]
    AccountNotFound,
    #[msg("Tick is in invalid Range")]
    InvalidTickRange,
    #[msg("Account Data is wrong")]
    InvalidAccountData,
}