//! Authorisation and wiring: who may configure the engine, and what it refuses
//! to be configured against.
//!
//! Settlement itself is deliberately permissionless (see [`super::settlement`]),
//! so the interesting guards are on *configuration*: the engine will not start
//! unless the registry and the pool already name it, and only its admin can
//! move it to different contracts.

use soroban_sdk::{testutils::Address as _, Address, Env};

use oracle_adapter::OracleAdapter;
use policy_registry::{PolicyRegistry, PolicyRegistryClient};
use premium_pool::{PremiumPool, PremiumPoolClient, DEFAULT_MIN_SOLVENCY_RATIO_BPS};

use super::{setup, DAY, WINDOW_OPEN};
use crate::{PayoutEngine, PayoutEngineClient};

/// Deploys a registry, pool and oracle that are running but have no payout
/// engine wired in, plus the admin that owns them.
fn unwired_stack(env: &Env) -> (Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let registry = env.register(PolicyRegistry, ());
    let pool = env.register(PremiumPool, ());
    let oracle = env.register(OracleAdapter, ());

    PolicyRegistryClient::new(env, &registry).initialize(&admin, &token);
    PremiumPoolClient::new(env, &pool).initialize(&admin, &token, &DEFAULT_MIN_SOLVENCY_RATIO_BPS);

    (admin, registry, pool, oracle)
}

// ---------------------------------------------------------------------------
// Admin authority
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_repoint_the_engine() {
    let w = setup();
    let stranger = Address::generate(&w.env);

    w.engine_client()
        .configure(&stranger, &w.registry, &w.pool, &w.oracle);
}

#[test]
fn the_admin_can_repoint_the_engine_at_new_contracts() {
    let w = setup();
    let replacement = w.env.register(OracleAdapter, ());

    w.engine_client()
        .configure(&w.admin, &w.registry, &w.pool, &replacement);

    assert_eq!(w.engine_client().contracts().oracle, replacement);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialize_can_only_run_once() {
    let w = setup();

    w.engine_client()
        .initialize(&w.admin, &w.registry, &w.pool, &w.oracle);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn configuration_views_fail_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let engine = env.register(PayoutEngine, ());

    PayoutEngineClient::new(&env, &engine).admin();
}

// ---------------------------------------------------------------------------
// Wiring guards
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn the_engine_refuses_to_start_against_a_registry_that_does_not_name_it() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, registry, pool, oracle) = unwired_stack(&env);
    let engine = env.register(PayoutEngine, ());
    PremiumPoolClient::new(&env, &pool).set_payout_engine(&admin, &engine);

    // The pool is ready to pay this engine but the registry has never heard of
    // it, so no settlement could ever complete. Accepting the wiring would just
    // move that failure to the first farmer who claims.
    PayoutEngineClient::new(&env, &engine).initialize(&admin, &registry, &pool, &oracle);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn the_engine_refuses_to_start_against_a_pool_that_does_not_name_it() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, registry, pool, oracle) = unwired_stack(&env);
    let engine = env.register(PayoutEngine, ());
    PolicyRegistryClient::new(&env, &registry).set_payout_engine(&admin, &engine);

    PayoutEngineClient::new(&env, &engine).initialize(&admin, &registry, &pool, &oracle);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn the_engine_cannot_be_configured_to_orchestrate_itself() {
    let w = setup();

    w.engine_client()
        .configure(&w.admin, &w.registry, &w.pool, &w.engine);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn two_configuration_slots_cannot_share_a_contract() {
    let w = setup();

    // A single address in two roles would silently double up the calls the
    // engine makes, so it is rejected rather than half-working.
    w.engine_client()
        .configure(&w.admin, &w.registry, &w.pool, &w.pool);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn the_engine_refuses_to_repoint_at_contracts_that_do_not_name_it() {
    let w = setup();
    let env = &w.env;
    let (_, other_registry, other_pool, other_oracle) = unwired_stack(env);

    // `configure` is re-validated, not just `initialize`: a rotation that
    // produced a dead engine would otherwise look successful.
    w.engine_client()
        .configure(&w.admin, &other_registry, &other_pool, &other_oracle);
}

// ---------------------------------------------------------------------------
// Losing the mandate
// ---------------------------------------------------------------------------

#[test]
fn an_engine_that_was_rotated_out_pays_nothing_and_settles_nothing() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(120, WINDOW_OPEN + 5 * DAY);

    // Governance moves the registry to a replacement engine.
    let replacement = w.env.register(PayoutEngine, ());
    w.registry_client()
        .set_payout_engine(&w.admin, &replacement);

    let result = w.engine_client().try_settle_policy(&policy_id);

    // The old engine still holds the pool's mandate, so the payment itself goes
    // through — and then the registry refuses to record the settlement, which
    // rolls the whole call back. Paying without settling is exactly the state
    // the ordering of those two calls exists to prevent.
    assert!(result.is_err());
    assert_eq!(w.token_client().balance(&w.farmer), 0);
    assert!(w.registry_client().is_active(&policy_id));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn a_farmer_cannot_settle_their_own_policy_at_the_registry() {
    // Settlement needs no signature from the keeper, but it does need the
    // *invoking contract* to be the registered engine: the registry checks the
    // caller address, not just that somebody authorised the call.
    let w = setup();
    let policy_id = w.create_default_policy();

    w.registry_client().mark_settled(&w.farmer, &policy_id);
}
