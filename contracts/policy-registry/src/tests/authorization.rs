//! Authorisation: which actor is allowed to call which entry point.

use soroban_sdk::{testutils::Address as _, testutils::MockAuth};

use super::{setup, PolicySpec};
use crate::PolicyStatus;

#[test]
#[should_panic(expected = "Error(Auth")]
fn create_policy_requires_the_farmers_signature() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let no_auths: &[MockAuth] = &[];
    w.env.mock_auths(no_auths);

    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn mark_settled_rejects_a_caller_that_is_not_the_payout_engine() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));
    let impostor = Address::generate(&w.env);

    // `impostor` can produce a signature (mock_all_auths), but it is not the
    // registered engine address so the whole call is rejected.
    w.registry_client().mark_settled(&impostor, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn the_admin_cannot_settle_policies() {
    let w = setup();
    let id = w.create(&PolicySpec::new(&w.env));

    w.registry_client().mark_settled(&w.admin, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_rotate_the_payout_engine() {
    let w = setup();
    let new_engine = Address::generate(&w.env);

    w.registry_client().set_payout_engine(&w.farmer, &new_engine);
}

#[test]
fn the_admin_can_rotate_the_payout_engine() {
    let w = setup();
    let new_engine = Address::generate(&w.env);

    w.registry_client().set_payout_engine(&w.admin, &new_engine);

    assert_eq!(w.registry_client().payout_engine(), new_engine);

    // The rotated engine settles; the old one is now powerless.
    let id = w.create(&PolicySpec::new(&w.env));
    w.registry_client().mark_settled(&new_engine, &id);

    assert_eq!(
        w.registry_client().get_policy(&id).status,
        PolicyStatus::Settled
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn the_previously_rotated_engine_can_no_longer_settle() {
    let w = setup();
    let new_engine = Address::generate(&w.env);
    w.registry_client().set_payout_engine(&w.admin, &new_engine);

    let id = w.create(&PolicySpec::new(&w.env));
    w.registry_client().mark_settled(&w.engine, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn set_payout_engine_rejects_a_non_admin_before_state_changes() {
    let w = setup();
    let attacker = Address::generate(&w.env);

    w.registry_client().set_payout_engine(&attacker, &attacker);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn initialize_requires_the_admin_signature() {
    let w = setup();
    let no_auths: &[MockAuth] = &[];
    w.env.mock_auths(no_auths);

    w.registry_client().initialize(&w.admin, &w.token);
}
