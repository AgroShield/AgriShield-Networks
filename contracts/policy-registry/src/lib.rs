#![no_std]
//! # AgriShield · PolicyRegistry
//!
//! Mints parametric weather-insurance policies, escrows the farmer's premium
//! and is the single source of truth other contracts read for policy terms.
//!
//! ## Invariants
//! 1. A policy id is allocated at most once; ids are strictly increasing and
//!    never reused, so an indexer can treat `policy_id` as an immutable key.
//! 2. Exactly one `Active` policy may exist per plot for a given instant:
//!    overlapping windows on the same `plot_hash` are rejected at creation.
//! 3. The full `premium` is transferred into this contract's own token balance
//!    (escrow) before the policy becomes readable. Premiums are only ever moved
//!    out by `cancel_policy` (refund) or by the registered payout engine.
//! 4. Only the admin may change configuration; only the registered payout
//!    engine contract may mark a policy settled.
//!
//! ## Authorisation
//! * `initialize` requires the admin's signature.
//! * `create_policy` / `cancel_policy` require the farmer's signature.
//! * Admin-only setters require the admin's signature.
//! * `mark_settled` additionally requires the caller to *be* the registered
//!   payout engine contract address (see [`policy`] docs and tests).

mod error;
mod events;
mod policy;
mod storage;
mod types;

#[cfg(test)]
mod tests;

pub use crate::error::Error;
pub use crate::events::{PolicyCreated, PolicyStatusChanged, PayoutEngineSet};
pub use crate::policy::{
    MAX_COVERAGE_WINDOW, MAX_PAYOUT_PREMIUM_RATIO_BPS, MAX_POLICIES_PER_PLOT,
    MIN_COVERAGE_WINDOW,
};
pub use crate::storage::DataKey;
pub use crate::types::{Policy, PolicyStatus};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol, Vec};

/// Storage-facing implementation of the AgriShield policy registry.
#[contract]
pub struct PolicyRegistry;

#[contractimpl]
impl PolicyRegistry {
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// One-time wiring of the registry: `admin` controls configuration and
    /// `premium_token` is the SAC-compatible asset premiums are paid in.
    pub fn initialize(env: Env, admin: Address, premium_token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_premium_token(&env, &premium_token);
        Ok(())
    }

    /// Registers the payout engine allowed to settle policies. Admin-only and
    /// re-callable so the engine can be rotated without redeploying.
    pub fn set_payout_engine(env: Env, admin: Address, payout_engine: Address) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        storage::set_payout_engine(&env, &payout_engine);
        events::payout_engine_set(&env, &PayoutEngineSet { payout_engine });
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Policies
    // -----------------------------------------------------------------------

    /// Mints a policy and escrows `premium` from `farmer`.
    ///
    /// Returns the new policy id. See [`policy::validate_parameters`] for the
    /// parameter rules and [`policy::assert_no_overlapping_policy`] for the
    /// double-insurance guard.
    #[allow(clippy::too_many_arguments)]
    pub fn create_policy(
        env: Env,
        farmer: Address,
        plot_hash: BytesN<32>,
        crop_type: Symbol,
        region_id: Symbol,
        coverage_start: u64,
        coverage_end: u64,
        trigger_threshold: i128,
        payout_amount: i128,
        premium: i128,
    ) -> Result<u64, Error> {
        if !storage::is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        farmer.require_auth();

        policy::validate_parameters(
            &env,
            coverage_start,
            coverage_end,
            trigger_threshold,
            payout_amount,
            premium,
        )?;
        policy::assert_no_overlapping_policy(&env, &plot_hash, coverage_start, coverage_end)?;

        // Cap the payout relative to premium so a single mispriced product
        // cannot drain pooled reserves. Basis points, so divide by 10_000.
        let max_payout = (premium * MAX_PAYOUT_PREMIUM_RATIO_BPS) / 10_000;
        if payout_amount > max_payout {
            return Err(Error::InvalidPayout);
        }

        let policy_id = storage::next_policy_id(&env)?;
        let now = env.ledger().timestamp();

        let record = Policy {
            id: policy_id,
            farmer: farmer.clone(),
            plot_hash: plot_hash.clone(),
            crop_type: crop_type.clone(),
            region_id: region_id.clone(),
            coverage_start,
            coverage_end,
            trigger_threshold,
            payout_amount,
            premium,
            status: PolicyStatus::Active,
            created_at: now,
            settled_at: 0,
        };

        // Escrow before publishing the policy so a failing transfer cannot
        // leave a readable policy without backing premium.
        policy::escrow_premium(&env, &farmer, premium)?;

        storage::save_policy(&env, &record);
        storage::add_plot_policy(&env, &plot_hash, policy_id, MAX_POLICIES_PER_PLOT)?;
        storage::add_farmer_policy(&env, &farmer, policy_id)?;
        storage::add_region_policy(&env, &region_id, policy_id)?;

        events::policy_created(
            &env,
            &PolicyCreated {
                policy_id,
                farmer,
                plot_hash,
                crop_type,
                region_id,
                coverage_start,
                coverage_end,
                trigger_threshold,
                payout_amount,
                premium,
            },
        );

        Ok(policy_id)
    }

    /// Reads a policy. Fails with [`Error::PolicyNotFound`] for unknown ids.
    pub fn get_policy(env: Env, policy_id: u64) -> Result<Policy, Error> {
        storage::get_policy(&env, policy_id)
    }

    /// Number of policies ever minted (also the last allocated id).
    pub fn get_policy_count(env: Env) -> u64 {
        storage::policy_count(&env)
    }

    /// True when the policy exists and is still settleable.
    pub fn is_active(env: Env, policy_id: u64) -> Result<bool, Error> {
        Ok(storage::get_policy(&env, policy_id)?.is_active())
    }

    /// Premium balance currently sitting in escrow.
    pub fn escrow_balance(env: Env) -> Result<i128, Error> {
        policy::escrow_balance(&env)
    }

    /// Policy ids minted for a farmer, oldest first.
    pub fn get_farmer_policies(env: Env, farmer: Address) -> Vec<u64> {
        storage::farmer_policy_ids(&env, &farmer)
    }

    /// Policy ids registered for a region, oldest first.
    pub fn get_region_policies(env: Env, region_id: Symbol) -> Vec<u64> {
        storage::region_policy_ids(&env, &region_id)
    }

    /// Cancels an `Active` policy before its window opens and refunds the
    /// premium. Farmer-signed; after `coverage_start` the policy is binding.
    pub fn cancel_policy(env: Env, policy_id: u64) -> Result<(), Error> {
        let mut record = storage::get_policy(&env, policy_id)?;
        record.farmer.require_auth();
        if !record.is_active() {
            return Err(Error::PolicyNotActive);
        }
        if env.ledger().timestamp() >= record.coverage_start {
            return Err(Error::InvalidCoverageWindow);
        }
        policy::release_escrow(&env, &record.farmer, record.premium)?;
        let now = env.ledger().timestamp();
        policy::transition(&mut record, PolicyStatus::Cancelled, now)?;
        storage::save_policy(&env, &record);
        events::policy_status_changed(
            &env,
            &PolicyStatusChanged {
                policy_id,
                status: PolicyStatus::Cancelled as u32,
                payout_amount: 0,
                settled_at: now,
            },
        );
        Ok(())
    }

    /// Marks a policy settled. Callable only by the registered payout engine
    /// contract; the engine releases the actual payout from the premium pool.
    pub fn mark_settled(env: Env, caller: Address, policy_id: u64) -> Result<(), Error> {
        caller.require_auth();
        storage::require_payout_engine(&env, &caller)?;

        let mut record = storage::get_policy(&env, policy_id)?;
        if !record.is_active() {
            return Err(Error::PolicyNotActive);
        }
        let now = env.ledger().timestamp();
        policy::transition(&mut record, PolicyStatus::Settled, now)?;
        storage::save_policy(&env, &record);
        events::policy_status_changed(
            &env,
            &PolicyStatusChanged {
                policy_id,
                status: PolicyStatus::Settled as u32,
                payout_amount: record.payout_amount,
                settled_at: now,
            },
        );
        Ok(())
    }

    /// Marks a policy expired once its window closed without a trigger.
    /// Permissionless so the settlement keeper is not a single point of failure.
    pub fn expire_policy(env: Env, policy_id: u64) -> Result<(), Error> {
        let mut record = storage::get_policy(&env, policy_id)?;
        if !record.is_active() {
            return Err(Error::PolicyNotActive);
        }
        let now = env.ledger().timestamp();
        if now <= record.coverage_end {
            return Err(Error::InvalidCoverageWindow);
        }
        policy::transition(&mut record, PolicyStatus::Expired, now)?;
        storage::save_policy(&env, &record);
        events::policy_status_changed(
            &env,
            &PolicyStatusChanged {
                policy_id,
                status: PolicyStatus::Expired as u32,
                payout_amount: 0,
                settled_at: now,
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn admin(env: Env) -> Result<Address, Error> {
        storage::get_admin(&env).ok_or(Error::NotInitialized)
    }

    pub fn premium_token(env: Env) -> Result<Address, Error> {
        storage::get_premium_token(&env)
    }

    pub fn payout_engine(env: Env) -> Result<Address, Error> {
        storage::get_payout_engine(&env)
    }
}
