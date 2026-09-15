//! Policy creation: parameter validation, id allocation and premium custody.

use soroban_sdk::{testutils::Address as _, Env, Symbol};

use super::{setup, PolicySpec, DAY, T0};
use crate::{PolicyRegistry, PolicyRegistryClient, PolicyStatus};

#[test]
fn creates_policy_with_supplied_terms() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    let policy = w.registry_client().get_policy(&id);

    assert_eq!(id, 1);
    assert_eq!(policy.id, 1);
    assert_eq!(policy.farmer, w.farmer);
    assert_eq!(policy.plot_hash, spec.plot_hash);
    assert_eq!(policy.crop_type, spec.crop_type);
    assert_eq!(policy.region_id, spec.region_id);
    assert_eq!(policy.coverage_start, spec.coverage_start);
    assert_eq!(policy.coverage_end, spec.coverage_end);
    assert_eq!(policy.trigger_threshold, spec.trigger_threshold);
    assert_eq!(policy.payout_amount, spec.payout_amount);
    assert_eq!(policy.premium, spec.premium);
    assert_eq!(policy.status, PolicyStatus::Active);
    assert_eq!(policy.created_at, T0);
    assert_eq!(policy.settled_at, 0);
}

#[test]
fn allocates_sequential_ids_starting_at_one() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);

    let first = w.create(&spec);
    let second = w.create(&spec.clone().on_plot(w.plot(2)));
    let third = w.create(&spec.clone().on_plot(w.plot(3)));

    assert_eq!((first, second, third), (1, 2, 3));
    assert_eq!(w.registry_client().get_policy_count(), 3);
}

#[test]
fn escrows_the_full_premium_on_mint() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let farmer_before = w.token_client().balance(&w.farmer);

    w.create(&spec);

    assert_eq!(
        w.token_client().balance(&w.farmer),
        farmer_before - spec.premium
    );
    assert_eq!(
        w.token_client().balance(&w.registry),
        spec.premium,
        "premium must be held in the registry escrow account"
    );
    assert_eq!(w.registry_client().escrow_balance(), spec.premium);
}

#[test]
fn indexes_policy_by_farmer_and_region() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    assert_eq!(
        w.registry_client().get_farmer_policies(&w.farmer),
        soroban_sdk::vec![&w.env, id]
    );
    assert_eq!(
        w.registry_client().get_region_policies(&spec.region_id),
        soroban_sdk::vec![&w.env, id]
    );
}

#[test]
fn supports_multiple_crops_and_regions_for_one_farmer() {
    let w = setup();
    let mut spec = PolicySpec::new(&w.env);
    spec.crop_type = Symbol::new(&w.env, "sorghum");
    spec.region_id = Symbol::new(&w.env, "ke_machakos");

    let first = w.create(&spec);
    let second = w.create(&PolicySpec::new(&w.env).on_plot(w.plot(9)));

    assert_eq!(
        w.registry_client().get_farmer_policies(&w.farmer),
        soroban_sdk::vec![&w.env, first, second]
    );
    assert_eq!(
        w.registry_client().get_region_policies(&Symbol::new(&w.env, "ke_machakos")),
        soroban_sdk::vec![&w.env, first]
    );
}

#[test]
fn accepts_a_window_starting_far_in_the_future() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + 90 * DAY, T0 + 180 * DAY);

    let id = w.create(&spec);

    assert!(w.registry_client().is_active(&id));
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn rejects_zero_premium() {
    let w = setup();
    let mut spec = PolicySpec::new(&w.env);
    spec.premium = 0;
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn rejects_non_positive_payout() {
    let w = setup();
    let mut spec = PolicySpec::new(&w.env);
    spec.payout_amount = 0;
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn rejects_negative_trigger_threshold() {
    let w = setup();
    let mut spec = PolicySpec::new(&w.env);
    spec.trigger_threshold = -1;
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn rejects_payout_above_the_pool_safety_ratio() {
    let w = setup();
    let mut spec = PolicySpec::new(&w.env);
    // Payout may not exceed 5x premium: 5,000 premium -> max 25,000 payout.
    spec.payout_amount = 25_001;
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn fails_when_the_farmer_cannot_cover_the_premium() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let broke = soroban_sdk::Address::generate(&w.env);

    // `broke` is a valid signer (mock_all_auths) but holds no premium tokens.
    w.registry_client().create_policy(
        &broke,
        &spec.plot_hash,
        &spec.crop_type,
        &spec.region_id,
        &spec.coverage_start,
        &spec.coverage_end,
        &spec.trigger_threshold,
        &spec.payout_amount,
        &spec.premium,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn create_fails_before_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let registry = env.register(PolicyRegistry, ());
    let client = PolicyRegistryClient::new(&env, &registry);
    let farmer = soroban_sdk::Address::generate(&env);

    client.create_policy(
        &farmer,
        &soroban_sdk::BytesN::from_array(&env, &[1u8; 32]),
        &Symbol::new(&env, "maize"),
        &Symbol::new(&env, "ng_kaduna"),
        &(T0 + DAY),
        &(T0 + 60 * DAY),
        &350,
        &2_000,
        &5_000,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialize_is_one_time_only() {
    let w = setup();
    w.registry_client().initialize(&w.admin, &w.token);
}

#[test]
fn escrow_starts_empty_and_payout_engine_is_recorded() {
    let w = setup();

    assert_eq!(w.registry_client().escrow_balance(), 0);
    assert_eq!(w.registry_client().admin(), w.admin);
    assert_eq!(w.registry_client().premium_token(), w.token);
    assert_eq!(w.registry_client().payout_engine(), w.engine);
}
