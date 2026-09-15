//! Authorisation surface of the oracle adapter.

use soroban_sdk::{testutils::Address as _, testutils::MockAuth, Address};

use super::setup;
use crate::OracleAdapterClient;

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_add_signers() {
    let w = setup(1, 1);
    let attacker = Address::generate(&w.env);

    w.client().add_signer(&attacker, &attacker);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_remove_signers() {
    let w = setup(1, 2);

    w.client().remove_signer(&w.signers[0], &w.signers[1]);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn only_the_admin_can_change_the_threshold() {
    let w = setup(1, 2);

    w.client().set_threshold(&w.signers[0], &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn initialize_can_only_run_once() {
    let w = setup(1, 1);
    w.client().initialize(&w.admin, &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn initialize_rejects_a_zero_threshold() {
    let w = setup(1, 1);
    let fresh = w.env.register(crate::OracleAdapter, ());
    OracleAdapterClient::new(&w.env, &fresh).initialize(&w.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Auth")]
fn submitting_an_index_requires_the_signers_signature() {
    let w = setup(1, 1);
    let no_auths: &[MockAuth] = &[];
    w.env.mock_auths(no_auths);

    w.client()
        .submit_index(&w.signers[0], &w.region_id, &300, &1_700_000_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_removed_signer_loses_the_right_to_submit() {
    let w = setup(1, 2);
    w.client().remove_signer(&w.admin, &w.signers[1]);

    w.client()
        .submit_index(&w.signers[1], &w.region_id, &300, &1_700_000_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn reading_interfaces_are_unavailable_before_initialize() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let adapter = env.register(crate::OracleAdapter, ());
    let client = OracleAdapterClient::new(&env, &adapter);

    client.get_threshold();
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn signers_cannot_be_added_before_initialize() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let adapter = env.register(crate::OracleAdapter, ());
    let client = OracleAdapterClient::new(&env, &adapter);
    let who = Address::generate(&env);

    client.add_signer(&who, &who);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn submissions_are_rejected_before_initialize() {
    let env = soroban_sdk::Env::default();
    env.mock_all_auths();
    let adapter = env.register(crate::OracleAdapter, ());
    let client = OracleAdapterClient::new(&env, &adapter);
    let who = Address::generate(&env);

    client.submit_index(&who, &soroban_sdk::Symbol::new(&env, "ng_kaduna"), &100, &0);
}
