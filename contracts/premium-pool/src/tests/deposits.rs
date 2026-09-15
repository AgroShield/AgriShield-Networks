//! Capital in: deposits, accounting counters and the payer's own balance.

use soroban_sdk::{
    testutils::{Address as _, MockAuth},
    Address,
};

use super::setup;
use crate::DEFAULT_MIN_SOLVENCY_RATIO_BPS;

#[test]
fn deposit_moves_capital_into_the_pool() {
    let w = setup();

    w.deposit(250_000);

    assert_eq!(w.pool_client().reserves(), 250_000);
    assert_eq!(w.token_client().balance(&w.pool), 250_000);
    assert_eq!(w.token_client().balance(&w.donor), 750_000);
}

#[test]
fn deposits_from_multiple_parties_accumulate() {
    let w = setup();
    let reinsurer = Address::generate(&w.env);
    w.mint(&reinsurer, 500_000);

    w.deposit(100_000);
    w.pool_client().deposit(&reinsurer, &400_000);

    assert_eq!(w.pool_client().reserves(), 500_000);
    assert_eq!(w.pool_client().stats().total_deposited, 500_000);
}

#[test]
fn deposit_does_not_create_liability() {
    let w = setup();

    w.deposit(100_000);

    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert!(w.pool_client().is_solvent());
}

#[test]
fn deposit_updates_the_stats_snapshot() {
    let w = setup();

    w.deposit(300_000);

    let stats = w.pool_client().stats();
    assert_eq!(stats.reserves, 300_000);
    assert_eq!(stats.total_deposited, 300_000);
    assert_eq!(stats.total_released, 0);
    assert_eq!(stats.total_withdrawn, 0);
    assert_eq!(stats.min_solvency_ratio_bps, DEFAULT_MIN_SOLVENCY_RATIO_BPS);
    // No recognised liability yet, so the ratio saturates.
    assert_eq!(stats.solvency_ratio_bps, i128::MAX);
}

#[test]
fn the_pool_holds_no_internal_ledger() {
    let w = setup();
    w.deposit(120_000);

    // Send tokens straight to the pool contract, outside the deposit path.
    w.mint(&w.pool, 30_000);

    // Reserves follow the real token balance, so books can never drift.
    assert_eq!(w.pool_client().reserves(), 150_000);
    // The accounting counter only tracks the deposit path.
    assert_eq!(w.pool_client().stats().total_deposited, 120_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_zero_deposit_is_rejected() {
    let w = setup();
    w.deposit(0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_negative_deposit_is_rejected() {
    let w = setup();
    w.deposit(-1);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn a_deposit_without_balance_fails() {
    let w = setup();
    let broke = Address::generate(&w.env);

    w.pool_client().deposit(&broke, &10_000);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn a_deposit_requires_the_payers_signature() {
    let w = setup();
    let no_auths: &[MockAuth] = &[];
    w.env.mock_auths(no_auths);

    w.pool_client().deposit(&w.donor, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn deposits_fail_before_initialize() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let pool = env.register(crate::PremiumPool, ());
    let who = Address::generate(&env);

    crate::PremiumPoolClient::new(&env, &pool).deposit(&who, &1);
}
