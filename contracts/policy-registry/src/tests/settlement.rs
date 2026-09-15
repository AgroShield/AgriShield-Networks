//! Settlement and expiry: engine-only settlement, idempotency and permissionless
//! expiry.

use super::{setup, PolicySpec, DAY, T0};
use crate::PolicyStatus;

#[test]
fn engine_can_settle_an_active_policy() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().mark_settled(&w.engine, &id);

    let policy = w.registry_client().get_policy(&id);
    assert_eq!(policy.status, PolicyStatus::Settled);
    assert_eq!(policy.settled_at, T0);
    assert!(!w.registry_client().is_active(&id));
}

#[test]
fn settlement_does_not_move_escrow_funds() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    // The premium stays in the registry; the payout engine releases capital
    // from the premium pool, which is a separate solvency domain.
    w.registry_client().mark_settled(&w.engine, &id);

    assert_eq!(w.registry_client().escrow_balance(), spec.premium);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn a_policy_cannot_be_settled_twice() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().mark_settled(&w.engine, &id);
    w.registry_client().mark_settled(&w.engine, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn settlement_fails_for_an_unknown_policy() {
    let w = setup();
    w.registry_client().mark_settled(&w.engine, &99);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn settlement_fails_for_a_cancelled_policy() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().cancel_policy(&id);
    w.registry_client().mark_settled(&w.engine, &id);
}

#[test]
fn settlement_before_the_window_ends_is_allowed_for_the_engine() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    // A season can be called early when the index has already breached the
    // trigger for the whole remaining window; the engine decides, not the clock.
    w.at(spec.coverage_start + DAY);
    w.registry_client().mark_settled(&w.engine, &id);

    assert_eq!(
        w.registry_client().get_policy(&id).status,
        PolicyStatus::Settled
    );
}

#[test]
fn anyone_can_expire_a_policy_after_its_window_closes() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_end + 1);
    // No signature: expiry is a cleanup action, safe to expose permissionless.
    w.registry_client().expire_policy(&id);

    let policy = w.registry_client().get_policy(&id);
    assert_eq!(policy.status, PolicyStatus::Expired);
    assert_eq!(policy.settled_at, spec.coverage_end + 1);
}

#[test]
fn expiry_is_allowed_exactly_one_second_after_the_window_ends() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_end + 1);
    w.registry_client().expire_policy(&id);

    assert!(!w.registry_client().is_active(&id));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn expiry_fails_at_the_last_second_of_the_window() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_end);
    w.registry_client().expire_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn expiry_fails_twice() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_end + 1);
    w.registry_client().expire_policy(&id);
    w.registry_client().expire_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn expiry_fails_for_a_settled_policy() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.registry_client().mark_settled(&w.engine, &id);
    w.at(spec.coverage_end + 1);
    w.registry_client().expire_policy(&id);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn expiry_fails_for_an_unknown_policy() {
    let w = setup();
    w.registry_client().expire_policy(&3);
}

#[test]
fn an_expired_plot_can_be_reinsured_for_the_next_season() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);

    w.at(spec.coverage_end + 1);
    w.registry_client().expire_policy(&first);

    let next =
        PolicySpec::new(&w.env).covering(spec.coverage_end + DAY, spec.coverage_end + 60 * DAY);
    let second = w.create(&next);

    assert_eq!(second, 2);
}

#[test]
fn an_expired_policy_still_reports_its_original_terms() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let id = w.create(&spec);

    w.at(spec.coverage_end + 1);
    w.registry_client().expire_policy(&id);

    let policy = w.registry_client().get_policy(&id);
    assert_eq!(policy.premium, spec.premium);
    assert_eq!(policy.payout_amount, spec.payout_amount);
    assert_eq!(policy.created_at, T0);
}
