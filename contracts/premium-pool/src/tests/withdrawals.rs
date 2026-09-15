//! Capital out (surplus): the solvency floor on admin withdrawals.

use soroban_sdk::{testutils::Address as _, Address};

use super::setup;
use crate::{FULLY_COLLATERALISED_BPS, MAX_SOLVENCY_RATIO_BPS};

#[test]
fn the_admin_can_withdraw_all_surplus_capital() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);

    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &100_000);

    assert_eq!(w.token_client().balance(&treasury), 100_000);
    assert_eq!(w.pool_client().reserves(), 0);
    assert_eq!(w.pool_client().stats().total_withdrawn, 100_000);
}

#[test]
fn the_admin_can_withdraw_up_to_the_solvency_floor() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(50_000);

    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &40_000);

    assert_eq!(w.pool_client().reserves(), 60_000);
    // 60,000 x 10,000 / 50,000 = 120% — exactly on the floor.
    assert_eq!(w.pool_client().solvency_ratio_bps(), 12_000);
    assert!(w.pool_client().is_solvent());
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn a_withdrawal_that_breaches_the_floor_is_rejected() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(50_000);

    // One unit past the 40,000 surplus.
    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &40_001);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn capital_backing_live_policies_cannot_be_withdrawn_at_all() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(50_000);
    // 45,000 liability at 120% locks 54,000 of the 50,000 on hand: the pool is
    // already short of its own floor, so nothing may leave.
    w.accrue(45_000);
    assert_eq!(w.pool_client().max_withdrawable(), 0);

    w.pool_client().withdraw_reserve(&w.admin, &treasury, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn withdrawing_more_than_reserves_fails() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(10_000);

    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &10_001);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_zero_withdrawal_is_rejected() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(10_000);

    w.pool_client().withdraw_reserve(&w.admin, &treasury, &0);
}

#[test]
fn reclaiming_capital_after_liability_is_released_is_allowed() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(50_000);

    // Season ends without a trigger: the liability disappears and the capital
    // becomes withdrawable again.
    w.engine_client().release(&w.pool, &50_000);
    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &100_000);

    assert_eq!(w.token_client().balance(&treasury), 100_000);
}

#[test]
fn raising_the_floor_can_retroactively_lock_capital() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(50_000);
    assert_eq!(w.pool_client().max_withdrawable(), 40_000);

    // A risk committee decision: keep 200% cover instead of 120%.
    w.pool_client().set_min_solvency_ratio(&w.admin, &20_000);

    assert_eq!(w.pool_client().max_withdrawable(), 0);
    assert_eq!(w.pool_client().solvency_ratio_bps(), 20_000);
    let _ = treasury;
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn capital_that_was_withdrawable_before_a_floor_increase_is_locked() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(20_000);

    w.pool_client().set_min_solvency_ratio(&w.admin, &20_000);
    // 100,000 vs 20,000 liability at 200%: 40,000 locked, 60,000 free.
    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &60_001);
}

#[test]
fn lowering_the_floor_frees_capital() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(50_000);
    assert_eq!(w.pool_client().max_withdrawable(), 40_000);

    w.pool_client()
        .set_min_solvency_ratio(&w.admin, &FULLY_COLLATERALISED_BPS);
    assert_eq!(w.pool_client().max_withdrawable(), 50_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn a_zero_solvency_ratio_is_rejected() {
    let w = setup();
    w.pool_client().set_min_solvency_ratio(&w.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn a_negative_solvency_ratio_is_rejected() {
    let w = setup();
    w.pool_client().set_min_solvency_ratio(&w.admin, &-1);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn an_absurdly_high_solvency_ratio_is_rejected() {
    let w = setup();
    w.pool_client()
        .set_min_solvency_ratio(&w.admin, &(MAX_SOLVENCY_RATIO_BPS + 1));
}

#[test]
fn multiple_withdrawals_cannot_together_breach_the_floor() {
    let w = setup();
    let treasury = Address::generate(&w.env);
    w.deposit(100_000);
    w.accrue(50_000);

    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &20_000);
    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &20_000);

    // The floor is re-evaluated per call, so the second one already hit it and
    // no further capital is available.
    assert_eq!(w.pool_client().reserves(), 60_000);
    assert_eq!(w.token_client().balance(&treasury), 40_000);
    assert_eq!(w.pool_client().max_withdrawable(), 0);
}
