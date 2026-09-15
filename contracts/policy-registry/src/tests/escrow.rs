//! Premium custody: escrow accounting and cancellation refunds.

use soroban_sdk::testutils::Address as _;

use super::{setup, PolicySpec, T0, DAY};
use crate::PolicyStatus;

#[test]
fn cancel_refunds_the_premium_and_marks_the_policy_cancelled() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);
    let balance_after_buying = w.token_client().balance(&w.farmer);

    w.registry_client().cancel_policy(&id);

    assert_eq!(
        w.token_client().balance(&w.farmer),
        balance_after_buying + spec.premium
    );
    assert_eq!(w.registry_client().escrow_balance(), 0);

    let policy = w.registry_client().get_policy(&id);
    assert_eq!(policy.status, PolicyStatus::Cancelled);
    assert_eq!(policy.settled_at, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn cancel_fails_once_the_coverage_window_has_opened() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_start);
    w.registry_client().cancel_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn cancel_fails_twice() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().cancel_policy(&id);
    w.registry_client().cancel_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn cancel_fails_for_an_already_settled_policy() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().mark_settled(&w.engine, &id);
    w.registry_client().cancel_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn cancel_fails_for_an_unknown_policy() {
    let w = setup();
    w.registry_client().cancel_policy(&42);
}

#[test]
fn cancel_just_before_the_window_opens_is_allowed() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_start - 1);
    w.registry_client().cancel_policy(&id);

    assert_eq!(
        w.registry_client().get_policy(&id).status,
        PolicyStatus::Cancelled
    );
}

#[test]
fn escrow_returns_to_zero_when_every_premium_is_refunded() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);
    let second = w.create(&spec.clone().on_plot(w.plot(2)));
    let starting_balance = w.token_client().balance(&w.farmer);

    assert_eq!(w.registry_client().escrow_balance(), spec.premium * 2);
    w.registry_client().cancel_policy(&first);
    w.registry_client().cancel_policy(&second);

    assert_eq!(w.registry_client().escrow_balance(), 0);
    assert_eq!(
        w.token_client().balance(&w.farmer),
        starting_balance + spec.premium * 2
    );
}

#[test]
fn cancelling_a_policy_does_not_remove_ids_from_the_farmer_index() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().cancel_policy(&id);

    // The index is append-only: clients filter on status instead of relying on
    // ids disappearing (which would renumber history).
    assert_eq!(
        w.registry_client().get_farmer_policies(&w.farmer),
        soroban_sdk::vec![&w.env, id]
    );
    assert_eq!(w.registry_client().get_policy_count(), 1);
}

#[test]
fn premiums_from_different_farmers_share_one_escrow() {
    let w = setup();
    let other = soroban_sdk::Address::generate(&w.env);
    w.mint(&other, 10_000);
    let spec = PolicySpec::new(&w.env);

    w.create(&spec);
    w.registry_client().create_policy(
        &other,
        &w.plot(2),
        &spec.crop_type,
        &spec.region_id,
        &(spec.coverage_start + DAY),
        &(spec.coverage_end + DAY),
        &spec.trigger_threshold,
        &spec.payout_amount,
        &spec.premium,
    );

    assert_eq!(w.registry_client().escrow_balance(), spec.premium * 2);
}

#[test]
fn a_cancelled_plot_can_be_insured_again_immediately() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);
    w.registry_client().cancel_policy(&first);

    let second = w.create(&spec);

    assert_ne!(first, second);
    assert!(w.registry_client().is_active(&second));
    assert_eq!(w.registry_client().escrow_balance(), spec.premium);
}

#[test]
fn refund_does_not_touch_other_policies_escrow() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);
    let second = w.create(&spec.clone().on_plot(w.plot(2)));

    w.registry_client().cancel_policy(&first);

    assert_eq!(w.registry_client().escrow_balance(), spec.premium);
    assert!(w.registry_client().is_active(&second));
    assert_eq!(
        w.registry_client().get_policy(&second).status,
        PolicyStatus::Active
    );
}
