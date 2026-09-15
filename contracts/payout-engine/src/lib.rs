#![no_std]
//! # AgriShield · PayoutEngine
//!
//! The only contract that moves money for a claim. It reads the terms of a live
//! policy from the policy registry, asks the oracle adapter whether the region's
//! index ever breached the policy's threshold *inside* the coverage window, and
//! — if it did — releases the payout from the premium pool before marking the
//! policy settled.
//!
//! ## Invariants
//! 1. Settlement is decided only by finalized oracle readings whose timestamp
//!    falls within `[coverage_start, coverage_end]`. A reading published before
//!    cover began, or after it closed, can never trigger a payment.
//! 2. The registry marks a policy `Settled` only *after* the pool has paid.
//!    Doing it the other way round would let a failed transfer leave a farmer
//!    holding a settled, worthless policy.
//! 3. Liability is recognised on the pool exactly once per policy, and every
//!    exit (payout, expiry, cancellation) releases the same amount. The pool's
//!    liability figure therefore stays balanced across policies in flight
//!    instead of drifting as each one settles.
//! 4. `settle_policy` and `expire_policy` are permissionless — any keeper may
//!    push one, so settlement is not a single point of failure. Forgery is
//!    still impossible: the registry and pool each independently check that the
//!    *calling contract* is their registered engine.
//! 5. Only the admin may re-point the engine at a new registry, pool or oracle.
//!
//! ## Trust model
//! The engine holds no funds and has no authority of its own; it can only do
//! what the registry and pool permit a *registered* engine to do. Compromising
//! it cannot mint tokens, and every settlement leaves an event trail on all
//! three contracts.
//!
//! ## Known limitation
//! The oracle keeps a bounded history per region, so a policy must be settled
//! while the reading that decides it is still retained. [`PayoutEngine::expire_policy`]
//! is the deterministic fallback once a window has closed.

mod abi;
mod clients;
mod error;
mod events;
mod storage;
mod trigger;
mod types;

pub use crate::abi::{IndexReading, Policy, PolicyStatus};
pub use crate::clients::{
    OracleAdapterClient, OracleAdapterInterface, PolicyRegistryClient, PolicyRegistryInterface,
    PremiumPoolClient, PremiumPoolInterface,
};
pub use crate::error::Error;
pub use crate::events::ContractsConfigured;
pub use crate::storage::DataKey;
pub use crate::trigger::{evaluate_terms, find_trigger, Decision};
pub use crate::types::{Contracts, SettlementOutcome, SettlementStatus, TriggerEvaluation};

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};

/// Storage-facing implementation of the AgriShield payout engine.
#[contract]
pub struct PayoutEngine;

#[contractimpl]
impl PayoutEngine {
    // -----------------------------------------------------------------------
    // Lifecycle & configuration
    // -----------------------------------------------------------------------

    /// One-time wiring of the engine to the three contracts it orchestrates.
    ///
    /// Both the registry and the pool must already name *this* contract as their
    /// payout engine: an engine that is not registered could never release a
    /// payout, so accepting the wiring would just move the failure to the first
    /// settlement. Deploy in the order registry → pool → engine.
    pub fn initialize(
        env: Env,
        admin: Address,
        policy_registry: Address,
        premium_pool: Address,
        oracle: Address,
    ) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        apply_contracts(&env, policy_registry, premium_pool, oracle)
    }

    /// Re-points the engine at new contracts. Admin-only and re-validated, so a
    /// registry or pool can be replaced without redeploying the engine.
    pub fn configure(
        env: Env,
        admin: Address,
        policy_registry: Address,
        premium_pool: Address,
        oracle: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        apply_contracts(&env, policy_registry, premium_pool, oracle)
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Read-only preview of what [`Self::settle_policy`] would do right now.
    ///
    /// No state change and no authorisation, so a keeper can sweep every live
    /// policy in a region each round and only submit the settlements that will
    /// actually do something. The status it reports is produced by the same
    /// pure decision procedure settlement uses.
    pub fn evaluate(env: Env, policy_id: u64) -> Result<TriggerEvaluation, Error> {
        let policy = load_active_policy(&env, policy_id)?;
        let history = load_history(&env, &policy.region_id)?;
        let decision = trigger::evaluate_terms(
            &history,
            policy.coverage_start,
            policy.coverage_end,
            policy.trigger_threshold,
            env.ledger().timestamp(),
        );
        let (index_value, reading_timestamp) = match decision.reading() {
            Some(reading) => (reading.index_value, reading.timestamp),
            None => (0, 0),
        };
        Ok(TriggerEvaluation {
            policy_id,
            status: decision.status(),
            index_value,
            reading_timestamp,
            payout_amount: if decision.reading().is_some() {
                policy.payout_amount
            } else {
                0
            },
        })
    }

    /// The three contracts this engine orchestrates.
    pub fn contracts(env: Env) -> Result<Contracts, Error> {
        Ok(Contracts {
            policy_registry: storage::get_policy_registry(&env)?,
            premium_pool: storage::get_premium_pool(&env)?,
            oracle: storage::get_oracle(&env)?,
        })
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        storage::get_admin(&env)
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Reads a policy from the registry.
///
/// Any registry failure maps to [`Error::PolicyNotFound`]: in a correctly wired
/// deployment the only reason `get_policy` can fail is an unknown id.
fn load_policy(env: &Env, policy_id: u64) -> Result<Policy, Error> {
    let registry = clients::PolicyRegistryClient::new(env, &storage::get_policy_registry(env)?);
    match registry.try_get_policy(&policy_id) {
        Ok(Ok(policy)) => Ok(policy),
        _ => Err(Error::PolicyNotFound),
    }
}

/// Reads a policy and requires it to still be settleable.
fn load_active_policy(env: &Env, policy_id: u64) -> Result<Policy, Error> {
    let policy = load_policy(env, policy_id)?;
    if !policy.is_active() {
        return Err(Error::PolicyNotActive);
    }
    Ok(policy)
}

/// The region's bounded, oldest-first reading history.
fn load_history(env: &Env, region_id: &Symbol) -> Result<Vec<IndexReading>, Error> {
    let oracle = clients::OracleAdapterClient::new(env, &storage::get_oracle(env)?);
    match oracle.try_get_index_history(region_id) {
        Ok(Ok(history)) => Ok(history),
        _ => Err(Error::OracleCallFailed),
    }
}

/// Validates and stores the three contract addresses.
///
/// Rejects a configuration that could never settle anything — the engine naming
/// itself, two slots naming the same contract, or a registry/pool that does not
/// list this engine as its payout engine — while the admin is still holding the
/// keys, rather than at the first claim.
fn apply_contracts(
    env: &Env,
    policy_registry: Address,
    premium_pool: Address,
    oracle: Address,
) -> Result<(), Error> {
    let me = env.current_contract_address();
    if policy_registry == me || premium_pool == me || oracle == me {
        return Err(Error::SelfReference);
    }
    if policy_registry == premium_pool || policy_registry == oracle || premium_pool == oracle {
        return Err(Error::DuplicateContract);
    }

    let registry = clients::PolicyRegistryClient::new(env, &policy_registry);
    if !matches!(registry.try_payout_engine(), Ok(Ok(engine)) if engine == me) {
        return Err(Error::EngineNotRegistered);
    }
    let pool = clients::PremiumPoolClient::new(env, &premium_pool);
    if !matches!(pool.try_payout_engine(), Ok(Ok(engine)) if engine == me) {
        return Err(Error::EngineNotRegistered);
    }

    storage::set_policy_registry(env, &policy_registry);
    storage::set_premium_pool(env, &premium_pool);
    storage::set_oracle(env, &oracle);

    events::contracts_configured(
        env,
        &ContractsConfigured {
            policy_registry,
            premium_pool,
            oracle,
        },
    );
    Ok(())
}
