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
//!    falls inside the half-open cover window `[coverage_start, coverage_end)`.
//!    A reading published before cover began, or after it closed, can never
//!    trigger a payment — the instant where two adjoining windows meet belongs
//!    to the later policy alone.
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

// The property tests drive `proptest`, which is built on `std`. Linking it for
// the test target only keeps the deployed contract itself `no_std`.
#[cfg(test)]
extern crate std;

mod abi;
mod clients;
mod error;
mod events;
mod storage;
mod trigger;
mod types;

#[cfg(test)]
mod tests;

pub use crate::abi::{IndexReading, Policy, PolicyStatus};
pub use crate::clients::{
    OracleAdapterClient, OracleAdapterInterface, PolicyRegistryClient, PolicyRegistryInterface,
    PremiumPoolClient, PremiumPoolInterface,
};
pub use crate::error::Error;
pub use crate::events::{
    ContractsConfigured, PolicyExpired, PolicyLiabilityRegistered, PolicyLiabilityReleased,
    PolicyPaid,
};
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
    // Settlement
    // -----------------------------------------------------------------------

    /// Settles a policy against the region's finalized index history.
    ///
    /// Pays the farmer when the index breached the policy's threshold inside the
    /// coverage window `[coverage_start, coverage_end)`, expires the policy when
    /// the window closed without a breach, and reports `Pending` when nothing is
    /// due yet. Retrying a `Pending` policy later is harmless; retrying a
    /// settled one fails because the policy is no longer active.
    ///
    /// Permissionless: settlement is keeper work, not privileged work, so a
    /// stalled operator cannot strand a farmer's claim. Forgery is still
    /// impossible, because the registry and the pool each independently verify
    /// that the *calling contract* is their registered payout engine.
    pub fn settle_policy(env: Env, policy_id: u64) -> Result<SettlementOutcome, Error> {
        let policy = load_active_policy(&env, policy_id)?;
        let history = load_history(&env, &policy.region_id)?;
        let decision = trigger::evaluate_terms(
            &history,
            policy.coverage_start,
            policy.coverage_end,
            policy.trigger_threshold,
            env.ledger().timestamp(),
        );

        match decision {
            trigger::Decision::Triggered(reading) => {
                pay(&env, &policy, &reading)?;
                Ok(SettlementOutcome {
                    policy_id,
                    status: SettlementStatus::Paid,
                    index_value: reading.index_value,
                    reading_timestamp: reading.timestamp,
                    paid_amount: policy.payout_amount,
                })
            }
            trigger::Decision::Expired => {
                expire(&env, &policy)?;
                Ok(SettlementOutcome::closed(
                    policy_id,
                    SettlementStatus::Expired,
                ))
            }
            trigger::Decision::Pending => Ok(SettlementOutcome::closed(
                policy_id,
                SettlementStatus::Pending,
            )),
        }
    }

    /// Expires a policy whose coverage window closed without a trigger.
    ///
    /// Exposed separately from [`Self::settle_policy`] so a keeper can force the
    /// deterministic path — and release the pool's liability — without waiting
    /// for the region's readings to age out of the oracle's bounded history.
    ///
    /// The window is half-open, so cover has ended the instant the clock reaches
    /// `coverage_end` and no reading from there on can ever qualify. Retiring
    /// the policy waits one second longer than that: the registry permits expiry
    /// only once the clock is *past* the window, so a call at exactly
    /// `coverage_end` is reported as [`Error::CoverageStillOpen`] instead of
    /// being forwarded as a transition the registry would reject.
    /// [`Self::settle_policy`] reports `Pending` over that same second, so the
    /// preview and the settlement keep agreeing.
    pub fn expire_policy(env: Env, policy_id: u64) -> Result<(), Error> {
        let policy = load_active_policy(&env, policy_id)?;
        if env.ledger().timestamp() <= policy.coverage_end {
            return Err(Error::CoverageStillOpen);
        }
        expire(&env, &policy)
    }

    // -----------------------------------------------------------------------
    // Cover liability
    // -----------------------------------------------------------------------

    /// Recognises a live policy's payout as liability on the premium pool.
    ///
    /// This is what stops the pool admin withdrawing capital that a live policy
    /// depends on, and it is permissionless for exactly that reason: anyone may
    /// lock the capital behind a policy they can see, and the call is idempotent
    /// per policy. It is *not* a way to grief the pool — every registered policy
    /// genuinely does represent that liability.
    ///
    /// Fails with [`Error::LiabilityAlreadyRegistered`] rather than silently
    /// double-counting, because an inflated liability figure would wrongly lock
    /// capital that no policy is claiming.
    pub fn register_liability(env: Env, policy_id: u64) -> Result<(), Error> {
        let policy = load_active_policy(&env, policy_id)?;
        if storage::liability_registered(&env, policy_id) {
            return Err(Error::LiabilityAlreadyRegistered);
        }

        let pool = clients::PremiumPoolClient::new(&env, &storage::get_premium_pool(&env)?);
        let me = env.current_contract_address();
        match pool.try_accrue_liability(&me, &policy.payout_amount) {
            Ok(Ok(())) => {}
            _ => return Err(Error::PoolCallFailed),
        }
        storage::mark_liability_registered(&env, policy_id);

        events::liability_registered(
            &env,
            &PolicyLiabilityRegistered {
                policy_id,
                payout_amount: policy.payout_amount,
            },
        );
        Ok(())
    }

    /// Drops the liability carried for a policy that can no longer pay out.
    ///
    /// This is the cancellation path: the registry refunds a farmer's premium
    /// before cover opens, and the pool must stop reserving capital for a policy
    /// that no longer exists. Only a policy that has already reached a terminal
    /// status is accepted — releasing liability for a live policy would free
    /// capital its eventual claim still needs.
    ///
    /// Idempotent for a policy whose liability was never recognised.
    pub fn release_liability(env: Env, policy_id: u64) -> Result<(), Error> {
        let policy = load_policy(&env, policy_id)?;
        if policy.is_active() {
            return Err(Error::PolicyStillActive);
        }
        release_liability_if_registered(&env, &policy)
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

    /// Whether the pool currently carries this policy's payout as liability.
    pub fn liability_registered(env: Env, policy_id: u64) -> bool {
        storage::liability_registered(&env, policy_id)
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

/// Pays a triggered claim and then marks the policy settled.
///
/// The order is load-bearing: the farmer is paid *before* the registry records
/// the policy as settled. Marking it first would let a failed transfer leave a
/// policy that reads as paid but never actually paid.
fn pay(env: &Env, policy: &Policy, reading: &IndexReading) -> Result<(), Error> {
    let me = env.current_contract_address();
    let pool = clients::PremiumPoolClient::new(env, &storage::get_premium_pool(env)?);

    // The payout reduces the pool's recognised liability by the amount paid, so
    // liability has to be on the books first: paying a policy whose payout was
    // never recognised would silently consume the cover held for another one.
    if !storage::liability_registered(env, policy.id) {
        match pool.try_accrue_liability(&me, &policy.payout_amount) {
            Ok(Ok(())) => {}
            _ => return Err(Error::PoolCallFailed),
        }
        storage::mark_liability_registered(env, policy.id);
    }

    match pool.try_release_payout(&me, &policy.farmer, &policy.payout_amount) {
        Ok(Ok(())) => {}
        _ => return Err(Error::PoolCallFailed),
    }
    storage::clear_liability_registered(env, policy.id);

    let registry = clients::PolicyRegistryClient::new(env, &storage::get_policy_registry(env)?);
    match registry.try_mark_settled(&me, &policy.id) {
        Ok(Ok(())) => {}
        _ => return Err(Error::RegistryCallFailed),
    }

    events::policy_paid(
        env,
        &PolicyPaid {
            policy_id: policy.id,
            farmer: policy.farmer.clone(),
            payout_amount: policy.payout_amount,
            index_value: reading.index_value,
            reading_timestamp: reading.timestamp,
        },
    );
    Ok(())
}

/// Marks a policy expired and stops reserving capital for it.
///
/// The registry moves first and the liability is released second. If the release
/// then failed, the pool would be left over-collateralised — recoverable, and on
/// the safe side. Releasing first would leave a live policy whose backing capital
/// had already been freed, so the failure would be a real hole.
fn expire(env: &Env, policy: &Policy) -> Result<(), Error> {
    // `expire_policy` is permissionless on the registry, so unlike the payout
    // path this one needs no caller identity to present.
    let registry = clients::PolicyRegistryClient::new(env, &storage::get_policy_registry(env)?);
    match registry.try_expire_policy(&policy.id) {
        Ok(Ok(())) => {}
        _ => return Err(Error::RegistryCallFailed),
    }
    release_liability_if_registered(env, policy)?;

    events::policy_expired(
        env,
        &PolicyExpired {
            policy_id: policy.id,
        },
    );
    Ok(())
}

/// Releases the pool liability carried for `policy`, if any.
///
/// The amount released is always the policy's full payout — exactly what
/// [`PayoutEngine::register_liability`] accrued — so the pool's liability figure
/// stays balanced policy by policy instead of drifting in aggregate.
///
/// A policy whose liability was never recognised is a no-op rather than an
/// error: cancelling a policy that was never registered must still work.
fn release_liability_if_registered(env: &Env, policy: &Policy) -> Result<(), Error> {
    if !storage::liability_registered(env, policy.id) {
        return Ok(());
    }

    let pool = clients::PremiumPoolClient::new(env, &storage::get_premium_pool(env)?);
    let me = env.current_contract_address();
    match pool.try_release_liability(&me, &policy.payout_amount) {
        Ok(Ok(())) => {}
        _ => return Err(Error::PoolCallFailed),
    }
    storage::clear_liability_registered(env, policy.id);

    events::liability_released(
        env,
        &PolicyLiabilityReleased {
            policy_id: policy.id,
            payout_amount: policy.payout_amount,
        },
    );
    Ok(())
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
