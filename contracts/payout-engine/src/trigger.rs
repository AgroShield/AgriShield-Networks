//! Pure trigger arithmetic.
//!
//! Parametric cover pays when an oracle-verified index breaches the policy's
//! threshold *inside* its coverage window. The rules live here, free of
//! cross-contract calls, so the off-chain keeper can reproduce a settlement
//! decision exactly and the contract's tests can drive every branch without
//! deploying the other three contracts.

use soroban_sdk::Vec;

use crate::abi::{IndexReading, TriggerCondition};
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

/// Evaluates whether an index reading satisfies the trigger condition.
pub fn matches_condition(index_value: i128, threshold: i128, condition: TriggerCondition) -> bool {
    match condition {
        TriggerCondition::BelowOrEqual => index_value <= threshold,
        TriggerCondition::AboveOrEqual => index_value >= threshold,
    }
}

/// Earliest reading inside `[coverage_start, coverage_end)` whose index reached
/// the policy's trigger threshold under the specified trigger condition.
pub fn find_trigger_with_condition(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
    condition: TriggerCondition,
) -> Option<IndexReading> {
    history.iter().find(|reading| {
        reading.timestamp >= coverage_start
            && reading.timestamp < coverage_end
            && matches_condition(reading.index_value, trigger_threshold, condition)
    })
}

/// Earliest reading inside `[coverage_start, coverage_end)` whose index reached
/// the policy's trigger threshold (defaulting to <= threshold for drought/frost).
pub fn find_trigger(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
) -> Option<IndexReading> {
    find_trigger_with_condition(
        history,
        coverage_start,
        coverage_end,
        trigger_threshold,
        TriggerCondition::BelowOrEqual,
    )
}

/// Decides what settlement should do for a policy right now under its trigger condition.
pub fn evaluate_terms_with_condition(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
    now: u64,
    condition: TriggerCondition,
) -> Decision {
    if let Some(reading) = find_trigger_with_condition(
        history,
        coverage_start,
        coverage_end,
        trigger_threshold,
        condition,
    ) {
        return Decision::Triggered(reading);
    }
    if now > coverage_end {
        Decision::Expired
    } else {
        Decision::Pending
    }
}

/// Decides what settlement should do for a policy right now (defaulting to <= threshold).
pub fn evaluate_terms(
    history: &Vec<IndexReading>,
    coverage_start: u64,
    coverage_end: u64,
    trigger_threshold: i128,
    now: u64,
) -> Decision {
    evaluate_terms_with_condition(
        history,
        coverage_start,
        coverage_end,
        trigger_threshold,
        now,
        TriggerCondition::BelowOrEqual,
    )
}
