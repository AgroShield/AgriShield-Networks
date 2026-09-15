//! Solvency arithmetic: the pure helpers plus the pool's health views.

use super::{setup, DEFAULT_MIN_SOLVENCY_RATIO_BPS};
use crate::solvency::{
    can_withdraw, max_withdrawable, ratio_bps, reduce_liability, required_reserves,
};
use crate::FULLY_COLLATERALISED_BPS;

#[test]
fn required_reserves_is_zero_without_liability() {
    assert_eq!(required_reserves(0, 12_000), 0);
    assert_eq!(required_reserves(-5, 12_000), 0);
}

#[test]
fn required_reserves_applies_the_ratio() {
    // 120% of 1,000 = 1,200
    assert_eq!(required_reserves(1_000, 12_000), 1_200);
}

#[test]
fn required_reserves_rounds_up_so_the_pool_is_never_a_token_short() {
    // 120% of 1 = 1.2 -> 2
    assert_eq!(required_reserves(1, 12_000), 2);
}

#[test]
fn required_reserves_at_one_hundred_percent_is_the_liability() {
    assert_eq!(required_reserves(9_999, FULLY_COLLATERALISED_BPS), 9_999);
}

#[test]
fn max_withdrawable_is_everything_when_there_is_no_liability() {
    assert_eq!(max_withdrawable(50_000, 0, 12_000), 50_000);
}

#[test]
fn max_withdrawable_keeps_the_ratio_intact() {
    // 10,000 reserves, 5,000 liability at 120% -> 6,000 locked -> 4,000 free.
    assert_eq!(max_withdrawable(10_000, 5_000, 12_000), 4_000);
}

#[test]
fn max_withdrawable_is_zero_when_the_pool_is_below_the_floor() {
    assert_eq!(max_withdrawable(1_000, 5_000, 12_000), 0);
}

#[test]
fn ratio_saturates_when_there_is_no_liability() {
    assert_eq!(ratio_bps(10_000, 0), i128::MAX);
}

#[test]
fn ratio_is_expressed_in_basis_points() {
    // 15,000 reserves against 10,000 liability = 150%
    assert_eq!(ratio_bps(15_000, 10_000), 15_000);
}

#[test]
fn can_withdraw_rejects_non_positive_amounts() {
    assert!(!can_withdraw(10_000, 0, 12_000, 0));
    assert!(!can_withdraw(10_000, 0, 12_000, -5));
}

#[test]
fn can_withdraw_rejects_amounts_beyond_reserves() {
    assert!(!can_withdraw(10_000, 0, 12_000, 10_001));
}

#[test]
fn can_withdraw_accepts_a_withdrawal_that_lands_exactly_on_the_floor() {
    // 10,000 reserves, 6,000 liability at 120%: 7,200 locked, 2,800 free.
    assert!(can_withdraw(10_000, 6_000, 12_000, 2_800));
    assert!(!can_withdraw(10_000, 6_000, 12_000, 2_801));
}

#[test]
fn reduce_liability_never_goes_negative() {
    assert_eq!(reduce_liability(500, 500), 0);
    assert_eq!(reduce_liability(500, 900), 0);
    assert_eq!(reduce_liability(900, 500), 400);
}

#[test]
fn arithmetic_stays_inside_i128_for_extreme_inputs() {
    // 1e15 units (10M tokens at 7 decimals) at a 100x ratio: 1e17, i.e. ~21
    // orders of magnitude below the i128 ceiling, but pinned so a future
    // refactor cannot silently overflow here.
    let required = required_reserves(1_000_000_000_000_000, 1_000_000);
    assert_eq!(required, 100_000_000_000_000_000);
    assert!(required > 0);
}

#[test]
fn views_reflect_the_configured_ratio() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(50_000);

    // 100,000 reserves vs 50,000 liability at a 120% floor.
    assert_eq!(
        w.pool_client().min_solvency_ratio_bps(),
        DEFAULT_MIN_SOLVENCY_RATIO_BPS
    );
    assert_eq!(w.pool_client().solvency_ratio_bps(), 20_000);
    assert_eq!(w.pool_client().max_withdrawable(), 40_000);
    assert!(w.pool_client().is_solvent());
}

#[test]
fn views_report_insolvency_when_capital_is_short() {
    let w = setup();
    w.deposit(100_000);
    // Recognise far more liability than the pool can cover.
    w.accrue(200_000);

    assert!(!w.pool_client().is_solvent());
    assert_eq!(w.pool_client().max_withdrawable(), 0);
    assert_eq!(w.pool_client().solvency_ratio_bps(), 5_000);
}

#[test]
fn liabilities_recognised_by_the_engine_are_visible_to_callers() {
    let w = setup();
    w.deposit(100_000);

    w.accrue(20_000);
    w.accrue(5_000);

    assert_eq!(w.pool_client().outstanding_liability(), 25_000);
    assert_eq!(
        w.engine_client().stats(&w.pool).outstanding_liability,
        25_000
    );
}
