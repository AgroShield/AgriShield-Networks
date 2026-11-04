//! Value types stored by the policy registry and read by other contracts.

use soroban_sdk::{contracttype, Address, BytesN, Symbol};

/// Lifecycle of a policy. `Active` policies are the only ones the payout engine
/// may settle; the rest are terminal.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyStatus {
    /// Premium escrowed, coverage window not yet resolved.
    Active = 0,
    /// Payout released by the payout engine.
    Settled = 1,
    /// Coverage window elapsed with no qualifying trigger (no payout due).
    Expired = 2,
    /// Cancelled by the farmer before coverage started; premium refunded.
    Cancelled = 3,
}

/// Direction of the parametric trigger condition:
/// * `BelowOrEqual`: pays when index <= threshold (drought, frost)
/// * `AboveOrEqual`: pays when index >= threshold (flood, extreme heat, rainfall excess)
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TriggerCondition {
    BelowOrEqual = 0,
    AboveOrEqual = 1,
}

/// A single parametric insurance policy.
///
/// Invariants enforced at creation time:
/// * `coverage_start < coverage_end`, window length >= [`crate::MIN_COVERAGE_WINDOW`]
/// * `premium > 0`, `payout_amount > 0`, `trigger_threshold >= 0`
/// * no other `Active` policy on `plot_hash` has an overlapping window
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub id: u64,
    pub farmer: Address,
    /// `sha256` of the plot geometry + farmer secret; never the raw geojson.
    pub plot_hash: BytesN<32>,
    pub crop_type: Symbol,
    pub region_id: Symbol,
    pub coverage_start: u64,
    pub coverage_end: u64,
    /// Threshold index value deciding payout.
    pub trigger_threshold: i128,
    pub payout_amount: i128,
    pub premium: i128,
    pub status: PolicyStatus,
    pub created_at: u64,
    /// Ledger timestamp at which the policy reached a terminal status
    /// (`Settled`, `Expired` or `Cancelled`); `0` while it is `Active`.
    pub settled_at: u64,
    /// Direction of trigger: BelowOrEqual (drought) or AboveOrEqual (flood).
    pub trigger_condition: TriggerCondition,
}

impl Policy {
    /// True when `self` is still settleable.
    pub fn is_active(&self) -> bool {
        matches!(self.status, PolicyStatus::Active)
    }

    /// True when `[start, end)` overlaps this policy's coverage window.
    pub fn overlaps(&self, start: u64, end: u64) -> bool {
        self.coverage_start < end && start < self.coverage_end
    }
}
