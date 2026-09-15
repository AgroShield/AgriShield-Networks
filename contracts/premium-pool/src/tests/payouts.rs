//! Capital out (claims): engine-driven payouts and liability bookkeeping.

use soroban_sdk::testutils::Address as _;

use super::setup;

#[test]
fn the_engine_can_pay_a_claim() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(20_000);

    w.settle(20_000);

    assert_eq!(w.token_client().balance(&w.farmer), 20_000);
    assert_eq!(w.pool_client().reserves(), 80_000);
    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(w.pool_client().stats().total_released, 20_000);
}

#[test]
fn a_claim_that_is_smaller_than_the_recognised_liability_leaves_the_rest() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(30_000);

    w.settle(10_000);

    assert_eq!(w.pool_client().outstanding_liability(), 20_000);
    assert_eq!(w.pool_client().reserves(), 90_000);
}

#[test]
fn liability_is_never_negative_after_an_over_sized_claim() {
    let w = setup();
    w.deposit(100_000);
    // The engine pays more than it recognised (e.g. a late index correction).
    w.accrue(5_000);

    w.settle(12_000);

    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(w.token_client().balance(&w.farmer), 12_000);
}

#[test]
fn claims_always_pay_even_when_the_pool_is_under_collateralised() {
    let w = setup();
    // Recognised liability exceeds the capital on hand: already below 100%.
    w.deposit(100_000);
    w.accrue(150_000);
    assert!(!w.pool_client().is_solvent());

    w.settle(40_000);

    // The solvency floor guards admin withdrawals and out-of-band capital
    // movement — never a farmer whose index has triggered. The pool pays what
    // it holds and reports the remaining shortfall honestly.
    assert_eq!(w.pool_client().reserves(), 60_000);
    assert_eq!(w.pool_client().outstanding_liability(), 110_000);
    assert_eq!(w.token_client().balance(&w.farmer), 40_000);
    assert!(!w.pool_client().is_solvent());
}

#[test]
fn the_engine_can_release_liability_it_no_longer_owes() {
    let w = setup();
    w.deposit(50_000);
    w.accrue(20_000);

    // Cover expired without a trigger, so the liability goes away.
    w.engine_client().release(&w.pool, &20_000);

    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(w.pool_client().reserves(), 50_000);
}

#[test]
fn releasing_liability_partially_keeps_the_remainder() {
    let w = setup();
    w.accrue(30_000);

    w.engine_client().release(&w.pool, &10_000);

    assert_eq!(w.pool_client().outstanding_liability(), 20_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn releasing_more_liability_than_is_recognised_fails() {
    let w = setup();
    w.accrue(10_000);

    w.engine_client().release(&w.pool, &10_001);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn accruing_zero_liability_is_rejected() {
    let w = setup();
    w.accrue(0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn releasing_zero_liability_is_rejected() {
    let w = setup();
    w.accrue(1_000);
    w.engine_client().release(&w.pool, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn a_claim_larger_than_reserves_fails_loudly() {
    let w = setup();
    w.deposit(10_000);
    w.accrue(25_000);

    // Under-capitalised: refusing beats partially paying a farmer who has
    // already been told the index triggered.
    w.settle(25_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_zero_payout_is_rejected() {
    let w = setup();
    w.deposit(10_000);
    w.settle(0);
}

#[test]
fn repeated_claims_drain_reserves_exactly() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(30_000);

    w.settle(10_000);
    w.settle(10_000);
    w.settle(10_000);

    assert_eq!(w.pool_client().reserves(), 70_000);
    assert_eq!(w.token_client().balance(&w.farmer), 30_000);
    assert_eq!(w.pool_client().stats().total_released, 30_000);
}

#[test]
fn premiums_deposited_after_claims_restore_capacity() {
    let w = setup();
    w.deposit(100_000);
    w.accrue(40_000);
    w.settle(40_000);

    // A new season's premiums arrive.
    let reinsurer = soroban_sdk::Address::generate(&w.env);
    w.mint(&reinsurer, 50_000);
    w.pool_client().deposit(&reinsurer, &50_000);

    assert_eq!(w.pool_client().reserves(), 110_000);
    assert_eq!(w.pool_client().stats().total_deposited, 150_000);
}
