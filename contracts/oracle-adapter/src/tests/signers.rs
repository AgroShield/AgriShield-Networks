//! Signer-set administration: registration, removal guards and thresholds.

use soroban_sdk::{testutils::Address as _, Address};

use super::setup;
use crate::MAX_SIGNERS;

#[test]
fn initialize_records_admin_and_threshold() {
    let w = setup(2, 3);

    assert_eq!(w.client().admin(), w.admin);
    assert_eq!(w.client().get_threshold(), 2);
    assert_eq!(w.client().get_signers().len(), 3);
}

#[test]
fn add_signer_registers_a_new_authority() {
    let w = setup(1, 1);
    let extra = Address::generate(&w.env);

    w.client().add_signer(&w.admin, &extra);

    assert!(w.client().is_signer(&extra));
    assert_eq!(w.client().get_signers().len(), 2);
}

#[test]
fn add_signer_preserves_insertion_order() {
    let w = setup(1, 1);
    let extra = Address::generate(&w.env);
    w.client().add_signer(&w.admin, &extra);

    let signers = w.client().get_signers();

    assert_eq!(signers.get(0).unwrap(), w.signers[0]);
    assert_eq!(signers.get(1).unwrap(), extra);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn adding_the_same_signer_twice_fails() {
    let w = setup(1, 1);
    w.client().add_signer(&w.admin, &w.signers[0]);
}

#[test]
fn remove_signer_deregisters_an_authority() {
    let w = setup(1, 2);

    w.client().remove_signer(&w.admin, &w.signers[1]);

    assert!(!w.client().is_signer(&w.signers[1]));
    assert_eq!(w.client().get_signers().len(), 1);
}

#[test]
fn removed_signer_can_be_added_back() {
    let w = setup(1, 2);
    w.client().remove_signer(&w.admin, &w.signers[1]);

    w.client().add_signer(&w.admin, &w.signers[1]);

    assert!(w.client().is_signer(&w.signers[1]));
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn removing_an_unknown_signer_fails() {
    let w = setup(1, 2);
    w.client().remove_signer(&w.admin, &w.outsider);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")]
fn removing_a_signer_below_the_threshold_fails() {
    let w = setup(2, 2);

    // Dropping to one signer would make a 2-of-2 policy unsatisfiable and
    // permanently stall settlements for every region.
    w.client().remove_signer(&w.admin, &w.signers[1]);
}

#[test]
fn removing_a_signer_is_allowed_when_one_spare_remains() {
    let w = setup(2, 3);

    w.client().remove_signer(&w.admin, &w.signers[2]);

    assert_eq!(w.client().get_signers().len(), 2);
    assert_eq!(w.client().get_threshold(), 2);
}

#[test]
fn lowering_the_threshold_then_removing_a_signer_is_allowed() {
    let w = setup(2, 2);

    w.client().set_threshold(&w.admin, &1);
    w.client().remove_signer(&w.admin, &w.signers[1]);

    assert_eq!(w.client().get_threshold(), 1);
    assert_eq!(w.client().get_signers().len(), 1);
}

#[test]
fn set_threshold_updates_the_requirement() {
    let w = setup(1, 3);

    w.client().set_threshold(&w.admin, &3);

    assert_eq!(w.client().get_threshold(), 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn threshold_of_zero_is_rejected() {
    let w = setup(1, 2);
    w.client().set_threshold(&w.admin, &0);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn threshold_above_the_signer_count_is_rejected() {
    let w = setup(1, 2);
    w.client().set_threshold(&w.admin, &3);
}

#[test]
fn threshold_equal_to_the_signer_count_is_accepted() {
    let w = setup(1, 2);

    w.client().set_threshold(&w.admin, &2);

    assert_eq!(w.client().get_threshold(), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #19)")]
fn signer_set_cannot_grow_past_the_cap() {
    let w = setup(1, 1);
    let start = w.client().get_signers().len();

    for _ in start..MAX_SIGNERS {
        w.client().add_signer(&w.admin, &Address::generate(&w.env));
    }
    assert_eq!(w.client().get_signers().len(), MAX_SIGNERS);

    // One beyond the cap must revert rather than silently growing storage.
    w.client().add_signer(&w.admin, &Address::generate(&w.env));
}

#[test]
fn unknown_address_is_not_a_signer() {
    let w = setup(1, 3);

    assert!(!w.client().is_signer(&w.outsider));
    assert_eq!(w.client().get_threshold(), 1);
}
