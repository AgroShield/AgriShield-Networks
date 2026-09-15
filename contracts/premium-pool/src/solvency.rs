//! Pure solvency arithmetic.
//!
//! All functions are integer-only so on-chain results are exact and
//! reproducible off-chain by the backend's risk dashboard.
//!
//! Definitions (basis points, `10_000` = 100%):
//! * `required_reserves = ceil(liability * ratio_bps / 10_000)`
//! * solvency holds iff `reserves >= required_reserves`
//! * `max_withdrawable = max(0, reserves - required_reserves)`

use crate::types::FULLY_COLLATERALISED_BPS;

/// Reserves that must stay locked to honour `liability` at `ratio_bps`.
///
/// Rounds *up* so the pool can never be one token short because of rounding.
pub fn required_reserves(liability: i128, ratio_bps: i128) -> i128 {
    if liability <= 0 {
        return 0;
    }
    (liability * ratio_bps + (FULLY_COLLATERALISED_BPS - 1)) / FULLY_COLLATERALISED_BPS
}

/// True when `reserves` covers the required amount.
pub fn is_solvent(reserves: i128, liability: i128, ratio_bps: i128) -> bool {
    reserves >= required_reserves(liability, ratio_bps)
}

/// Largest amount that may leave the pool without breaching the ratio.
pub fn max_withdrawable(reserves: i128, liability: i128, ratio_bps: i128) -> i128 {
    let required = required_reserves(liability, ratio_bps);
    if reserves <= required {
        0
    } else {
        reserves - required
    }
}

/// `reserves / liability` in basis points.
///
/// Returns `i128::MAX` when there is no recognised liability: the pool is
/// trivially solvent and the caller should render "∞" rather than a number.
pub fn ratio_bps(reserves: i128, liability: i128) -> i128 {
    if liability <= 0 {
        return i128::MAX;
    }
    (reserves * FULLY_COLLATERALISED_BPS) / liability
}

/// True when a withdrawal of `amount` keeps the pool compliant.
pub fn can_withdraw(reserves: i128, liability: i128, ratio_bps: i128, amount: i128) -> bool {
    if amount <= 0 || amount > reserves {
        return false;
    }
    is_solvent(reserves - amount, liability, ratio_bps)
}

/// Reduces `liability` by `amount`, never below zero.
pub fn reduce_liability(liability: i128, amount: i128) -> i128 {
    if amount >= liability {
        0
    } else {
        liability - amount
    }
}
