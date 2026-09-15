//! Value types and tunables for the premium pool.

use soroban_sdk::contracttype;

/// Default minimum solvency ratio: reserves must cover 120% of the recognised
/// liability. The 20% buffer absorbs index noise between accrual and settlement.
pub const DEFAULT_MIN_SOLVENCY_RATIO_BPS: i128 = 12_000;

/// Upper bound for the configured ratio (100x liability). Guards against a typo
/// making withdrawals impossible forever.
pub const MAX_SOLVENCY_RATIO_BPS: i128 = 1_000_000;

/// 100% in basis points — the point below which the pool is technically
/// insolvent if every recognised liability were claimed at once.
pub const FULLY_COLLATERALISED_BPS: i128 = 10_000;

/// A consistent snapshot of pool health. `solvency_ratio_bps` saturates so the
/// frontend can render an unbounded ratio safely.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    /// Tokens held by the pool contract right now.
    pub reserves: i128,
    /// Maximum payout the pool could be asked for, as reported by the engine.
    pub outstanding_liability: i128,
    /// Configured minimum ratio (basis points) enforced on withdrawals.
    pub min_solvency_ratio_bps: i128,
    /// `reserves / liability` in basis points, or [`i128::MAX`] when there is
    /// no recognised liability.
    pub solvency_ratio_bps: i128,
    pub total_deposited: i128,
    pub total_released: i128,
    pub total_withdrawn: i128,
}
