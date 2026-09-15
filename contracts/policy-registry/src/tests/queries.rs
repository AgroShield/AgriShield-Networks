//! Read paths used by the indexer and the frontend.

use super::{setup, PolicySpec, DAY};

#[test]
fn policy_count_is_zero_before_any_policy_exists() {
    let w = setup();

    assert_eq!(w.registry_client().get_policy_count(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn get_policy_fails_for_an_unknown_id() {
    let w = setup();
    w.registry_client().get_policy(&7);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn is_active_fails_for_an_unknown_id() {
    let w = setup();
    w.registry_client().is_active(&7);
}

#[test]
fn unknown_farmer_has_no_policies() {
    let w = setup();
    let stranger = soroban_sdk::Address::generate(&w.env);

    assert!(w
        .registry_client()
        .get_farmer_policies(&stranger)
        .is_empty());
}

#[test]
fn unknown_region_has_no_policies() {
    let w = setup();

    assert!(w
        .registry_client()
        .get_region_policies(&soroban_sdk::Symbol::new(&w.env, "tz_dodoma"))
        .is_empty());
}

#[test]
fn returns_every_policy_for_a_farmer_across_regions() {
    let w = setup();
    let mut first = PolicySpec::new(&w.env);
    first.region_id = soroban_sdk::Symbol::new(&w.env, "ke_machakos");
    let mut second = PolicySpec::new(&w.env).on_plot(w.plot(2));
    second.region_id = soroban_sdk::Symbol::new(&w.env, "ng_kaduna");

    let a = w.create(&first);
    let b = w.create(&second);

    assert_eq!(
        w.registry_client().get_farmer_policies(&w.farmer),
        soroban_sdk::vec![&w.env, a, b]
    );
}

#[test]
fn escrow_balance_accumulates_premiums_from_every_policy() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);

    w.create(&spec);
    w.create(&spec.clone().on_plot(w.plot(2)));
    w.create(&spec.clone().on_plot(w.plot(3)));

    assert_eq!(w.registry_client().escrow_balance(), spec.premium * 3);
}

#[test]
fn reflects_settlement_in_the_is_active_view() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    assert!(w.registry_client().is_active(&id));

    w.registry_client().mark_settled(&w.engine, &id);

    assert!(!w.registry_client().is_active(&id));
}

#[test]
fn policies_from_different_farmers_do_not_share_indexes() {
    let w = setup();
    let other = soroban_sdk::Address::generate(&w.env);
    w.mint(&other, 10_000);

    let spec = PolicySpec::new(&w.env);
    let mine = w.create(&spec);
    let theirs = w.registry_client().create_policy(
        &other,
        &w.plot(5),
        &spec.crop_type,
        &spec.region_id,
        &(spec.coverage_start + DAY),
        &(spec.coverage_end + DAY),
        &spec.trigger_threshold,
        &spec.payout_amount,
        &spec.premium,
    );

    assert_eq!(
        w.registry_client().get_farmer_policies(&w.farmer),
        soroban_sdk::vec![&w.env, mine]
    );
    assert_eq!(
        w.registry_client().get_farmer_policies(&other),
        soroban_sdk::vec![&w.env, theirs]
    );
}
