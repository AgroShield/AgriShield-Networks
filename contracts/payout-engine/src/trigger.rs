//! Pure trigger arithmetic.
//!
//! Parametric cover pays when an oracle-verified index breaches the policy's
//! threshold *inside* its coverage window. The rules live here, free of
//! cross-contract calls, so the off-chain keeper can reproduce a settlement
//! decision exactly and the contract's tests can drive every branch without
//! deploying the other three contracts.

use soroban_sdk::Vec;

use crate::abi::IndexReading;
use crate::types::SettlementStatus;

/// What the decision procedure concluded for a policy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Decision {
    /// A reading inside the coverage window breached the threshold.
    Triggered(IndexReading),
    /// The coverage window closed without a qualifying reading.
    Expired,
    /// The window is still open and nothing has breached the threshold yet.
    Pending,
}

impl Decision {
    /// The settlement status this decision maps to.
    pub fn status(&self) -> SettlementStatus {
        match self {
            Decision::Triggered(_) => SettlementStatus::Paid,
            Decision::Expired => SettlementStatus::Expired,
            Decision::Pending => SettlementStatus::Pending,
        }
    }

    /// The deciding reading, when the policy triggered.
    pub fn reading(&self) -> Option<&IndexReading> {
        match self {
            Decision::Triggered(reading) => Some(reading),
            _ => None,
        }
    }
}

/// Earliest reading inside `[coverage_start, coverage_end]` whose index reached
/// the policy's trigger threshold.
///
/// A policy pays when the observed index is *at or below* its threshold (a
/// drought trigger is "less rain than this"), and only readings taken while
/// cover was live may count. The window is inclusive at both ends, matching how
/// the registry validates it: cover runs from `coverage_start` through
/// `coverage_end`.
///
/// Returns the *earliest* qualifying reading rather than the latest, so the
/// amount paid never depends on how many observations happened to be published
/// afterwards.
pub fn find_trigger(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
) -> Option<IndexReading> {
    history.iter().find(|reading| {
        reading.timestamp >= coverage_start
            && reading.timestamp <= coverage_end
            && reading.index_value <= trigger_threshold
    })
}

/// Decides what settlement should do for a policy right now.
///
/// Both [`crate::PayoutEngine::settle_policy`] and
/// [`crate::PayoutEngine::evaluate`] route through this function, so a preview
/// can never disagree with the state change it previews.
pub fn evaluate_terms(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
    now: u64,
) -> Decision {
    if let Some(reading) = find_trigger(history, coverage_start, coverage_end, trigger_threshold) {
        return Decision::Triggered(reading);
    }
    // No qualifying reading. Once the window has closed no future observation
    // can fall inside it, so the policy can never pay and is expired instead.
    if now > coverage_end {
        Decision::Expired
    } else {
        Decision::Pending
    }
}
