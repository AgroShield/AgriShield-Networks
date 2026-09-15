//! Pure N-of-M helper functions (no host interaction).

use soroban_sdk::{testutils::Address as _, Address, Env, Symbol, Vec};

use crate::threshold::{
    can_remove_signer, proximity, reached, validate_approval, validate_signer_capacity,
    validate_threshold,
};
use crate::{Error, PendingReading};

#[test]
fn threshold_must_be_at_least_one() {
    assert_eq!(validate_threshold(0, 3), Err(Error::InvalidThreshold));
}

#[test]
fn threshold_may_not_exceed_the_signer_count() {
    assert_eq!(validate_threshold(4, 3), Err(Error::InvalidThreshold));
}

#[test]
fn threshold_equal_to_signer_count_is_valid() {
    assert_eq!(validate_threshold(3, 3), Ok(()));
}

#[test]
fn threshold_reached_is_inclusive() {
    assert!(!reached(2, 3));
    assert!(reached(3, 3));
    assert!(reached(4, 3));
}

#[test]
fn removing_a_signer_needs_one_to_spare() {
    assert!(can_remove_signer(3, 2));
    assert!(!can_remove_signer(2, 2));
    assert!(!can_remove_signer(1, 1));
}

#[test]
fn signer_capacity_stops_at_the_cap() {
    assert_eq!(validate_signer_capacity(0, 2), Ok(()));
    assert_eq!(validate_signer_capacity(2, 2), Err(Error::SignerSetFull));
}

#[test]
fn proximity_is_zero_once_the_trigger_has_breached() {
    assert_eq!(proximity(200, 350), 0);
    assert_eq!(proximity(350, 350), 0);
}

#[test]
fn proximity_reports_the_distance_above_the_trigger() {
    assert_eq!(proximity(400, 350), 50);
}

fn pending(env: &Env, value: i128, approvers: &[Address]) -> PendingReading {
    let mut approvals = Vec::new(env);
    for approver in approvers {
        approvals.push_back(approver.clone());
    }
    PendingReading {
        region_id: Symbol::new(env, "ng_kaduna"),
        index_value: value,
        timestamp: 1_700_000_000,
        approvals,
        first_seen_at: 1_700_000_000,
    }
}

#[test]
fn approval_is_rejected_when_the_value_disagrees() {
    let env = Env::default();
    let signer = Address::generate(&env);
    let reading = pending(&env, 300, &[]);

    assert_eq!(
        validate_approval(&reading, &signer, 301),
        Err(Error::ConflictingValue)
    );
}

#[test]
fn approval_is_rejected_when_the_signer_already_signed() {
    let env = Env::default();
    let signer = Address::generate(&env);
    let reading = pending(&env, 300, core::slice::from_ref(&signer));

    assert_eq!(
        validate_approval(&reading, &signer, 300),
        Err(Error::DuplicateApproval)
    );
}

#[test]
fn a_first_approval_is_accepted() {
    let env = Env::default();
    let signer = Address::generate(&env);

    assert_eq!(
        validate_approval(&pending(&env, 300, &[]), &signer, 300),
        Ok(())
    );
}

#[test]
fn has_approved_only_matches_the_exact_signer() {
    let env = Env::default();
    let signer = Address::generate(&env);
    let other = Address::generate(&env);
    let reading = pending(&env, 300, core::slice::from_ref(&signer));

    assert!(reading.has_approved(&signer));
    assert!(!reading.has_approved(&other));
    assert_eq!(reading.approval_count(), 1);
}
