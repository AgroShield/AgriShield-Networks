#![no_std]
//! # AgriShield · PremiumPool
//!
//! Custodian of the risk capital that backs AgriShield's parametric cover. It
//! holds premiums and reinsurer/donor deposits, recognises the liability the
//! payout engine reports, and enforces a solvency floor on every exit of funds.
//!
//! ## Invariants
//! 1. `reserves()` is always the *real* token balance of this contract — the
//!    pool keeps no internal ledger, so accounting cannot drift from reality.
//! 2. Reserve withdrawals (admin, out-of-band capital movement) are rejected
//!    unless `reserves >= ceil(liability * min_solvency_ratio_bps / 10_000)`
//!    still holds afterwards, so a reinsurer can never pull out the capital
//!    that farmers' live policies depend on.
//! 3. Payouts are released only to the registered payout engine contract, which
//!    must also authenticate (`require_auth`): a user cannot spoof the engine
//!    address because a contract address can only authenticate when it is in
//!    the call stack.
//! 4. A payout never exceeds current reserves; the pool fails loudly with
//!    `InsufficientReserves` instead of partially paying.
//! 5. Liability is recognised before it is releasable — `release_liability`
//!    larger than the recognised liability is an error, not silently clamped.
//!
//! ## Trust model
//! The admin can move *surplus* capital and rotate configuration, but cannot
//! touch reserves that back recognised liability, cannot mint tokens, and
//! cannot pay itself: the only way value leaves the pool is the solvency-checked
//! admin withdrawal or an engine-driven payout.

mod error;
mod events;
mod solvency;
mod storage;
mod types;

#[cfg(test)]
mod tests;

pub use crate::error::Error;
pub use crate::events::{
    Deposited, LiabilityChanged, PayoutEngineChanged, PayoutReleased, ReserveWithdrawn,
    SolvencyRatioChanged,
};
pub use crate::solvency::{
    can_withdraw, is_solvent, max_withdrawable, ratio_bps, reduce_liability, required_reserves,
};
pub use crate::storage::DataKey;
pub use crate::types::{
    PoolStats, DEFAULT_MIN_SOLVENCY_RATIO_BPS, FULLY_COLLATERALISED_BPS, MAX_SOLVENCY_RATIO_BPS,
};

use soroban_sdk::{contract, contractimpl, token, Address, Env};

/// Storage-facing implementation of the AgriShield premium pool.
#[contract]
pub struct PremiumPool;

#[contractimpl]
impl PremiumPool {
    // -----------------------------------------------------------------------
    // Lifecycle & configuration
    // -----------------------------------------------------------------------

    /// Wires the pool to the capital `token` and its solvency policy.
    ///
    /// `min_solvency_ratio_bps` must be within `1..=MAX_SOLVENCY_RATIO_BPS`.
    /// Use [`DEFAULT_MIN_SOLVENCY_RATIO_BPS`] (120%) unless a risk committee has
    /// decided otherwise.
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        min_solvency_ratio_bps: i128,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        validate_ratio(min_solvency_ratio_bps)?;
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::set_min_solvency_ratio(&env, min_solvency_ratio_bps);
        Ok(())
    }

    /// Registers the payout engine allowed to release payouts. Admin-only and
    /// re-callable so the engine can be rotated without redeploying the pool.
    pub fn set_payout_engine(
        env: Env,
        admin: Address,
        payout_engine: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        storage::set_payout_engine(&env, &payout_engine);
        events::payout_engine_changed(&env, &PayoutEngineChanged { payout_engine });
        Ok(())
    }

    /// Updates the solvency floor enforced on admin withdrawals. Admin-only.
    pub fn set_min_solvency_ratio(
        env: Env,
        admin: Address,
        min_solvency_ratio_bps: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        validate_ratio(min_solvency_ratio_bps)?;

        let previous_bps = storage::get_min_solvency_ratio(&env);
        storage::set_min_solvency_ratio(&env, min_solvency_ratio_bps);
        events::solvency_ratio_changed(
            &env,
            &SolvencyRatioChanged {
                previous_bps,
                current_bps: min_solvency_ratio_bps,
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Capital in
    // -----------------------------------------------------------------------

    /// Pulls `amount` of capital into the pool. Permissionless: anyone may
    /// capitalise the pool (reinsurer, donor, or the policy registry forwarding
    /// collected premiums).
    pub fn deposit(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        if !storage::is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        from.require_auth();
        transfer_in(&env, &from, amount)?;
        storage::add_deposited(&env, amount);
        events::deposited(
            &env,
            &Deposited {
                from,
                amount,
                reserves_after: reserves(&env)?,
                outstanding_liability: storage::get_outstanding_liability(&env),
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Liability recognition
    // -----------------------------------------------------------------------

    /// Recognises `amount` of new potential payout the pool must be able to
    /// honour (called when cover is sold).
    ///
    /// Engine-only: liability figures decide how much capital is locked, so
    /// letting anyone inflate them would be a griefing vector.
    pub fn accrue_liability(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        storage::require_payout_engine(&env, &caller)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let previous = storage::get_outstanding_liability(&env);
        let current = previous + amount;
        storage::set_outstanding_liability(&env, current);
        events::liability_changed(&env, &LiabilityChanged { previous, current });
        Ok(())
    }

    /// Removes `amount` of recognised liability (cover expired, was cancelled,
    /// or has just been paid out through [`Self::release_payout`]).
    pub fn release_liability(env: Env, caller: Address, amount: i128) -> Result<(), Error> {
        caller.require_auth();
        storage::require_payout_engine(&env, &caller)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let previous = storage::get_outstanding_liability(&env);
        if amount > previous {
            return Err(Error::LiabilityUnderflow);
        }
        let current = solvency::reduce_liability(previous, amount);
        storage::set_outstanding_liability(&env, current);
        events::liability_changed(&env, &LiabilityChanged { previous, current });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Capital out
    // -----------------------------------------------------------------------

    /// Pays a claim. Callable only by the registered payout engine.
    ///
    /// Liability is reduced by the payout afterwards, so the pool's solvency
    /// ratio improves with every claim paid.
    pub fn release_payout(
        env: Env,
        caller: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        caller.require_auth();
        storage::require_payout_engine(&env, &caller)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let available = reserves(&env)?;
        if amount > available {
            return Err(Error::InsufficientReserves);
        }

        // The pool holds no internal ledger and this call frame is the only thing
        // running, so the balance after the transfer is exactly `available`
        // minus what just left. The event used to ask the token contract again,
        // which cost a second cross-contract call on every single claim.
        transfer_out(&env, &to, amount)?;
        let reserves_after = available - amount;

        let previous_liability = storage::get_outstanding_liability(&env);
        let remaining = solvency::reduce_liability(previous_liability, amount);
        storage::set_outstanding_liability(&env, remaining);
        storage::add_released(&env, amount);

        events::payout_released(
            &env,
            &PayoutReleased {
                to,
                amount,
                reserves_after,
                remaining_liability: remaining,
            },
        );
        Ok(())
    }

    /// Moves surplus capital out of the pool (reinsurer profit taking, treasury
    /// operations). Admin-only, and only while the solvency floor still holds —
    /// i.e. only money that is not backing live policies can leave.
    pub fn withdraw_reserve(
        env: Env,
        admin: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let available = reserves(&env)?;
        if amount > available {
            return Err(Error::InsufficientReserves);
        }
        let liability = storage::get_outstanding_liability(&env);
        let ratio = storage::get_min_solvency_ratio(&env);
        if !solvency::can_withdraw(available, liability, ratio, amount) {
            return Err(Error::InsolventWithdrawal);
        }

        transfer_out(&env, &to, amount)?;
        storage::add_withdrawn(&env, amount);

        // Same identity as the payout path: nothing else can move this contract's
        // balance inside this call, so a second `balance()` cross-contract call
        // would buy a number we already know.
        let reserves_after = available - amount;
        events::reserve_withdrawn(
            &env,
            &ReserveWithdrawn {
                to,
                amount,
                reserves_after,
                solvency_ratio_bps: solvency::ratio_bps(reserves_after, liability),
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Live token balance held by the pool.
    pub fn reserves(env: Env) -> Result<i128, Error> {
        reserves(&env)
    }

    /// Liability currently recognised by the engine.
    pub fn outstanding_liability(env: Env) -> i128 {
        storage::get_outstanding_liability(&env)
    }

    pub fn min_solvency_ratio_bps(env: Env) -> i128 {
        storage::get_min_solvency_ratio(&env)
    }

    /// `reserves / liability` in basis points (`i128::MAX` when liability is 0).
    pub fn solvency_ratio_bps(env: Env) -> Result<i128, Error> {
        Ok(solvency::ratio_bps(
            reserves(&env)?,
            storage::get_outstanding_liability(&env),
        ))
    }

    /// True while the configured floor is respected.
    pub fn is_solvent(env: Env) -> Result<bool, Error> {
        Ok(solvency::is_solvent(
            reserves(&env)?,
            storage::get_outstanding_liability(&env),
            storage::get_min_solvency_ratio(&env),
        ))
    }

    /// Largest admin withdrawal that would keep the pool compliant right now.
    pub fn max_withdrawable(env: Env) -> Result<i128, Error> {
        Ok(solvency::max_withdrawable(
            reserves(&env)?,
            storage::get_outstanding_liability(&env),
            storage::get_min_solvency_ratio(&env),
        ))
    }

    /// One-call snapshot for the backend risk dashboard.
    pub fn stats(env: Env) -> Result<PoolStats, Error> {
        let reserves = reserves(&env)?;
        let liability = storage::get_outstanding_liability(&env);
        Ok(PoolStats {
            reserves,
            outstanding_liability: liability,
            min_solvency_ratio_bps: storage::get_min_solvency_ratio(&env),
            solvency_ratio_bps: solvency::ratio_bps(reserves, liability),
            total_deposited: storage::total_deposited(&env),
            total_released: storage::total_released(&env),
            total_withdrawn: storage::total_withdrawn(&env),
        })
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        storage::get_admin(&env)
    }

    pub fn token(env: Env) -> Result<Address, Error> {
        storage::get_token(&env)
    }

    pub fn payout_engine(env: Env) -> Result<Address, Error> {
        storage::get_payout_engine(&env)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn validate_ratio(ratio_bps: i128) -> Result<(), Error> {
    if ratio_bps <= 0 || ratio_bps > MAX_SOLVENCY_RATIO_BPS {
        return Err(Error::InvalidRatio);
    }
    Ok(())
}

/// Live token balance of this contract.
fn reserves(env: &Env) -> Result<i128, Error> {
    let token_id = storage::get_token(env)?;
    Ok(token::Client::new(env, &token_id).balance(&env.current_contract_address()))
}

fn transfer_in(env: &Env, from: &Address, amount: i128) -> Result<(), Error> {
    let token_id = storage::get_token(env)?;
    let client = token::Client::new(env, &token_id);
    let to = env.current_contract_address();
    if client.try_transfer(from, &to, &amount).is_err() {
        return Err(Error::TransferFailed);
    }
    Ok(())
}

fn transfer_out(env: &Env, to: &Address, amount: i128) -> Result<(), Error> {
    let token_id = storage::get_token(env)?;
    let client = token::Client::new(env, &token_id);
    let from = env.current_contract_address();
    if client.try_transfer(&from, to, &amount).is_err() {
        return Err(Error::TransferFailed);
    }
    Ok(())
}
