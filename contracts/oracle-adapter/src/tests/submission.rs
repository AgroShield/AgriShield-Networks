//! Partial signatures: pending readings, conflicts, staleness and sanity bands.

use super::{setup, T0, DAY};
use crate::MAX_INDEX_VALUE;

#[test]
fn single_signer_threshold_finalizes_immediately() {
    let w = setup(1, 1);

    let outcome = w.submit(&w.signers[0], 420, T0);

    assert!(outcome.finalized);
    assert_eq!(outcome.approvals, 1);
    assert_eq!(outcome.threshold, 1);
    assert_eq!(w.client().get_latest_index(&w.region_id).index_value, 420);
}

#[test]
fn first_approval_opens_a_pending_reading() {
    let w = setup(2, 2);

    let outcome = w.submit(&w.signers[0], 380, T0);

    assert!(!outcome.finalized);
    assert_eq!(outcome.approvals, 1);
    assert!(!w.client().has_reading(&w.region_id));

    let pending = w.client().get_pending_reading(&w.region_id, &T0);
    assert_eq!(pending.index_value, 380);
    assert_eq!(pending.approval_count(), 1);
    assert_eq!(pending.first_seen_at, T0);
}

#[test]
fn second_approval_reaches_a_two_of_two_threshold() {
    let w = setup(2, 2);

    w.submit(&w.signers[0], 380, T0);
    let outcome = w.submit(&w.signers[1], 380, T0);

    assert!(outcome.finalized);
    assert_eq!(outcome.approvals, 2);
    assert_eq!(w.client().get_latest_index(&w.region_id).index_value, 380);
    assert!(w.client().is_finalized(&w.region_id, &T0));
}

#[test]
fn two_of_three_finalizes_once_the_second_signature_lands() {
    let w = setup(2, 3);

    w.submit(&w.signers[0], 300, T0);
    let second = w.submit(&w.signers[1], 300, T0);

    assert!(second.finalized);
    assert_eq!(second.approvals, 2);

    let reading = w.client().get_latest_index(&w.region_id);
    assert_eq!(reading.index_value, 300);
    assert_eq!(reading.approvals, 2);
    assert!(w.client().is_finalized(&w.region_id, &T0));
}

#[test]
fn three_of_three_needs_every_signature() {
    let w = setup(3, 3);

    assert!(!w.submit(&w.signers[0], 250, T0).finalized);
    assert!(!w.submit(&w.signers[1], 250, T0).finalized);
    let last = w.submit(&w.signers[2], 250, T0);

    assert!(last.finalized);
    assert_eq!(last.approvals, 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn the_same_signer_cannot_approve_twice() {
    let w = setup(2, 3);

    w.submit(&w.signers[0], 300, T0);
    w.submit(&w.signers[0], 300, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn signers_must_agree_on_the_same_value() {
    let w = setup(2, 3);

    w.submit(&w.signers[0], 300, T0);
    // A disagreement must not split the vote into two half-signed readings.
    w.submit(&w.signers[1], 301, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn a_non_signer_cannot_submit() {
    let w = setup(2, 3);

    w.submit(&w.outsider, 300, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")]
fn negative_index_values_are_rejected() {
    let w = setup(1, 1);
    w.submit(&w.signers[0], -1, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #18)")]
fn absurdly_large_index_values_are_rejected() {
    let w = setup(1, 1);
    w.submit(&w.signers[0], MAX_INDEX_VALUE + 1, T0);
}

#[test]
fn the_maximum_accepted_index_value_is_allowed() {
    let w = setup(1, 1);

    let outcome = w.submit(&w.signers[0], MAX_INDEX_VALUE, T0);

    assert!(outcome.finalized);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn timestamps_far_in_the_future_are_rejected() {
    let w = setup(1, 1);
    w.submit(&w.signers[0], 100, T0 + 10 * DAY);
}

#[test]
fn a_timestamp_a_few_minutes_ahead_is_tolerated() {
    let w = setup(1, 1);

    // Small clock skew between signers and the ledger is acceptable.
    w.submit(&w.signers[0], 100, T0 + 60);

    assert!(w.client().is_finalized(&w.region_id, &(T0 + 60)));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn resubmitting_a_finalized_timestamp_is_rejected() {
    let w = setup(1, 2);

    w.submit(&w.signers[0], 100, T0);
    w.submit(&w.signers[1], 100, T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn older_readings_cannot_overwrite_newer_ones() {
    let w = setup(1, 1);

    w.submit(&w.signers[0], 100, T0 + DAY);
    w.submit(&w.signers[0], 90, T0);
}

#[test]
fn newer_readings_are_accepted_after_a_finalized_one() {
    let w = setup(1, 1);

    w.submit(&w.signers[0], 400, T0);
    let later = w.submit(&w.signers[0], 350, T0 + DAY);

    assert!(later.finalized);
    assert_eq!(w.client().get_latest_index(&w.region_id).index_value, 350);
    assert_eq!(w.client().get_latest_index(&w.region_id).timestamp, T0 + DAY);
}
