//! Value types the payout engine returns to keepers, the backend and the
//! indexer.

use soroban_sdk::{contracttype, Address};

/// What a settlement attempt concluded.
///
/// A keeper polls this to decide whether to stop retrying a policy.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SettlementStatus {
    /// The index breached the policy's threshold inside its coverage window, so
    /// the payout was dispatched and the policy marked settled.
    Paid = 0,
    /// The coverage window closed without a qualifying reading: the policy was
    /// marked expired and its liability released back to the pool.
    Expired = 1,
    /// The window is still open and nothing has breached the threshold yet.
    /// Nothing changed — the keeper should retry later.
    Pending = 2,
}

/// Result of [`crate::PayoutEngine::settle_policy`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementOutcome {
    pub policy_id: u64,
    pub status: SettlementStatus,
    /// Index value of the reading that decided the outcome; `0` when no
    /// qualifying reading exists.
    pub index_value: i128,
    /// Ledger timestamp of that reading; `0` when none.
    pub reading_timestamp: u64,
    /// Amount actually paid to the farmer; `0` unless `status == Paid`.
    pub paid_amount: i128,
}

/// Read-only preview of what settlement would do right now.
///
/// Safe to call for every policy in a region in one keeper pass, because it
/// performs no state change and no authorisation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TriggerEvaluation {
    pub policy_id: u64,
    /// The status [`crate::PayoutEngine::settle_policy`] would return.
    pub status: SettlementStatus,
    /// Index value of the deciding reading; `0` when none.
    pub index_value: i128,
    /// Ledger timestamp of the deciding reading; `0` when none.
    pub reading_timestamp: u64,
    /// Amount that would be paid; `0` unless `status == Paid`.
    pub payout_amount: i128,
}

/// The three contracts the engine orchestrates, in one snapshot.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contracts {
    /// Source of policy terms and the contract the engine settles.
    pub policy_registry: Address,
    /// Holder of the capital the engine pays claims out of.
    pub premium_pool: Address,
    /// Source of finalized weather-index readings.
    pub oracle: Address,
}
