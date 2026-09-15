//! Business rules for creating, cancelling and settling policies.
//!
//! Kept separate from [`crate::PolicyRegistry`] so the invariants below are
//! testable in isolation and the contract entry points stay thin.

use soroban_sdk::{token, Address, BytesN, Env};

use crate::error::Error;
use crate::storage;
use crate::types::{Policy, PolicyStatus};

const DAY: u64 = 24 * 60 * 60;

/// Shortest sellable coverage window. Shorter windows expose the pool to
/// adverse selection around a known weather forecast.
pub const MIN_COVERAGE_WINDOW: u64 = 7 * DAY;

/// Longest sellable coverage window. Bounded so persistent TTL extensions
/// always outlive the policy (see `storage::PERSISTENT_TTL_EXTEND_TO`).
pub const MAX_COVERAGE_WINDOW: u64 = 180 * DAY;

/// Maximum number of policies that may ever be registered against one plot.
/// Bounds the cost of the overlap scan below.
pub const MAX_POLICIES_PER_PLOT: u32 = 32;

/// A payout may not exceed this multiple of the premium, expressed in basis
/// points (50_000 bps = 5x). Guards the pool against a single mispriced product
/// draining reserves: even with a trigger probability of 1 in 5, a 5x payout is
/// at worst break-even on premium income alone.
pub const MAX_PAYOUT_PREMIUM_RATIO_BPS: i128 = 50_000; // 5x premium

/// Validates the economic and temporal parameters of a new policy.
#[allow(clippy::too_many_arguments)]
pub fn validate_parameters(
    env: &Env,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
    payout_amount: i128,
    premium: i128,
) -> Result<(), Error> {
    if coverage_end <= coverage_start {
        return Err(Error::InvalidCoverageWindow);
    }
    let window = coverage_end - coverage_start;
    if window < MIN_COVERAGE_WINDOW {
        return Err(Error::CoverageWindowTooShort);
    }
    if window > MAX_COVERAGE_WINDOW {
        return Err(Error::InvalidCoverageWindow);
    }
    // Policies can be created slightly in advance of the window, but never
    // after it has already started: retroactive cover is pure adverse selection.
    if coverage_start < env.ledger().timestamp() {
        return Err(Error::CoverageWindowInPast);
    }
    if premium <= 0 {
        return Err(Error::InvalidPremium);
    }
    if payout_amount <= 0 {
        return Err(Error::InvalidPayout);
    }
    if trigger_threshold < 0 {
        return Err(Error::InvalidThreshold);
    }
    Ok(())
}

/// Rejects a new window that overlaps an `Active` policy on the same plot.
///
/// The scan is bounded by [`MAX_POLICIES_PER_PLOT`]; index entries pointing at
/// missing policies are treated as free (they are stale, not conflicting).
pub fn assert_no_overlapping_policy(
    env: &Env,
    plot_hash: &BytesN<32>,
    coverage_start: u64,
    coverage_end: u64,
) -> Result<(), Error> {
    for id in storage::plot_policy_ids(env, plot_hash).iter() {
        if let Ok(existing) = storage::get_policy(env, id) {
            if existing.is_active() && existing.overlaps(coverage_start, coverage_end) {
                return Err(Error::DuplicateActivePolicy);
            }
        }
    }
    Ok(())
}

/// Moves `amount` of the premium token from `payer` into this contract
/// (the escrow account). Returns [`Error::PremiumTransferFailed`] instead of
/// letting the token contract trap, so callers get a typed error.
pub fn escrow_premium(env: &Env, payer: &Address, amount: i128) -> Result<(), Error> {
    let token_id = storage::get_premium_token(env)?;
    let client = token::Client::new(env, &token_id);
    let escrow = env.current_contract_address();
    if client.try_transfer(payer, &escrow, &amount).is_err() {
        return Err(Error::PremiumTransferFailed);
    }
    Ok(())
}

/// Sends `amount` back out of escrow (cancellation refund or payout).
pub fn release_escrow(env: &Env, recipient: &Address, amount: i128) -> Result<(), Error> {
    let token_id = storage::get_premium_token(env)?;
    let client = token::Client::new(env, &token_id);
    let escrow = env.current_contract_address();
    if client.try_transfer(&escrow, recipient, &amount).is_err() {
        return Err(Error::PremiumTransferFailed);
    }
    Ok(())
}

/// Current token balance held in escrow by this contract.
pub fn escrow_balance(env: &Env) -> Result<i128, Error> {
    let token_id = storage::get_premium_token(env)?;
    let client = token::Client::new(env, &token_id);
    Ok(client.balance(&env.current_contract_address()))
}

/// Applies a status transition, rejecting transitions out of a terminal state.
///
/// Every terminal status stamps `settled_at`, so an indexer can always answer
/// "when did this policy leave the book?" — whether that was a payout, an
/// expiry or a farmer cancellation.
pub fn transition(policy: &mut Policy, status: PolicyStatus, now: u64) -> Result<(), Error> {
    if !policy.is_active() {
        return Err(Error::PolicyNotActive);
    }
    policy.status = status;
    policy.settled_at = now;
    Ok(())
}
