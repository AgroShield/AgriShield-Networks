//! Authorisation: who may move capital and who may act as the engine.

use soroban_sdk::{testutils::Address as _, testutils::MockAuth, Address, Env};

use super::{setup, MockEngine, MockEngineClient};
use crate::{PremiumPool, PremiumPoolClient, DEFAULT_MIN_SOLVENCY_RATIO_BPS};

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn a_user_cannot_release_a_payout_from_the_pool() {
    let w = setup();
    w.deposit(100_000);

    w.pool_client()
        .release_payout(&w.farmer, &w.farmer, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn a_user_cannot_accrue_liability() {
    let w = setup();

    w.pool_client().accrue_liability(&w.donor, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn a_user_cannot_release_liability() {
    let w = setup();
    w.accrue(10_000);

    w.pool_client().release_liability(&w.donor, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn the_admin_cannot_act_as_the_payout_engine() {
    let w = setup();
    w.deposit(100_000);

    // Admin power covers configuration and surplus capital, never claims.
    w.pool_client().release_payout(&w.admin, &w.farmer, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn a_donor_cannot_withdraw_reserves() {
    let w = setup();
    w.deposit(100_000);
    let attacker = Address::generate(&w.env);

    w.pool_client()
        .withdraw_reserve(&w.donor, &attacker, &10_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_rotate_the_engine() {
    let w = setup();
    let attacker = Address::generate(&w.env);

    w.pool_client().set_payout_engine(&w.donor, &attacker);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_change_the_solvency_ratio() {
    let w = setup();

    w.pool_client().set_min_solvency_ratio(&w.donor, &20_000);
}

#[test]
fn the_admin_can_rotate_the_payout_engine() {
    let w = setup();
    w.deposit(100_000);
    let replacement = w.env.register(MockEngine, ());

    w.pool_client().set_payout_engine(&w.admin, &replacement);

    assert_eq!(w.pool_client().payout_engine(), replacement);

    // The rotated engine pays; the previous one is powerless.
    MockEngineClient::new(&w.env, &replacement).settle(&w.pool, &w.farmer, &5_000);
    assert_eq!(w.token_client().balance(&w.farmer), 5_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn the_previous_engine_loses_access_after_rotation() {
    let w = setup();
    w.deposit(100_000);
    let replacement = w.env.register(MockEngine, ());
    w.pool_client().set_payout_engine(&w.admin, &replacement);

    w.engine_client().settle(&w.pool, &w.farmer, &5_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn a_pool_without_an_engine_cannot_pay_out() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(PremiumPool, ());
    let client = PremiumPoolClient::new(&env, &pool);
    client.initialize(&admin, &token, &DEFAULT_MIN_SOLVENCY_RATIO_BPS);
    let anyone = Address::generate(&env);

    client.release_payout(&anyone, &anyone, &1);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn an_account_cannot_impersonate_the_engine_address() {
    let w = setup();
    w.deposit(100_000);

    // With signatures enforced, `engine.require_auth()` only succeeds when the
    // engine contract is actually in the call stack, so naming it as `caller`
    // from outside gets rejected before the allowlist check even runs.
    let no_auths: &[MockAuth] = &[];
    w.env.mock_auths(no_auths);

    w.pool_client().release_payout(&w.engine, &w.farmer, &1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialize_can_only_run_once() {
    let w = setup();
    w.pool_client()
        .initialize(&w.admin, &w.token, &DEFAULT_MIN_SOLVENCY_RATIO_BPS);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn initialize_rejects_an_invalid_ratio() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(PremiumPool, ());

    PremiumPoolClient::new(&env, &pool).initialize(&admin, &token, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn configuration_views_fail_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let pool = env.register(PremiumPool, ());

    PremiumPoolClient::new(&env, &pool).admin();
}
