//! Finalization semantics: immutability, pending cleanup, region isolation.

use super::{setup, T0, DAY};

#[test]
fn finalized_readings_are_immutable() {
    let w = setup(1, 1);

    w.submit(&w.signers[0], 500, T0);
    let first = w.client().get_latest_index(&w.region_id);

    // A later reading for a newer timestamp moves `latest` forward without
    // rewriting history.
    w.submit_at(&w.signers[0], 200, T0 + DAY);

    let history = w.client().get_index_history(&w.region_id);
    assert_eq!(history.get(0).unwrap(), first);
    assert_eq!(history.get(0).unwrap().index_value, 500);
    assert_eq!(w.client().get_latest_index(&w.region_id).index_value, 200);
}

#[test]
fn finalized_at_stamps_the_ledger_clock() {
    let w = setup(1, 1);
    w.at(T0 + 5 * DAY);

    // The observation describes yesterday; `finalized_at` records when the
    // chain learned about it.
    w.submit(&w.signers[0], 180, T0 + 4 * DAY);

    let reading = w.client().get_latest_index(&w.region_id);
    assert_eq!(reading.timestamp, T0 + 4 * DAY);
    assert_eq!(reading.finalized_at, T0 + 5 * DAY);
}

#[test]
fn approvals_are_recorded_on_the_final_reading() {
    let w = setup(3, 3);

    w.submit(&w.signers[0], 220, T0);
    w.submit(&w.signers[1], 220, T0);
    w.submit(&w.signers[2], 220, T0);

    assert_eq!(w.client().get_latest_index(&w.region_id).approvals, 3);
}

#[test]
fn regions_are_tracked_independently() {
    let w = setup(1, 1);
    let other = w.other_region();

    w.submit(&w.signers[0], 400, T0);
    w.client().submit_index(&w.signers[0], &other, &120, &T0);

    assert_eq!(w.client().get_latest_index(&w.region_id).index_value, 400);
    assert_eq!(w.client().get_latest_index(&other).index_value, 120);

    // Each region keeps its own history ring.
    assert_eq!(w.client().get_index_history(&w.region_id).len(), 1);
    assert_eq!(w.client().get_index_history(&other).len(), 1);
}

#[test]
fn a_region_with_no_reading_reports_absence_explicitly() {
    let w = setup(1, 1);

    assert!(!w.client().has_reading(&w.region_id));
    assert!(!w.client().is_finalized(&w.region_id, &T0));
    assert!(w.client().get_index_history(&w.region_id).is_empty());
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn latest_index_for_an_unknown_region_fails() {
    let w = setup(1, 1);
    w.client().get_latest_index(&w.other_region());
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn pending_reading_is_cleared_once_finalized() {
    let w = setup(2, 2);

    w.submit(&w.signers[0], 260, T0);
    assert_eq!(w.client().get_pending_reading(&w.region_id, &T0).approvals.len(), 1);

    w.submit(&w.signers[1], 260, T0);

    // Finalized state lives in `Latest`/`History`; the pending slot is gone.
    w.client().get_pending_reading(&w.region_id, &T0);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn pending_reading_is_missing_for_an_untouched_timestamp() {
    let w = setup(2, 2);
    w.client().get_pending_reading(&w.region_id, &T0);
}

#[test]
fn threshold_can_be_raised_before_any_submission() {
    let w = setup(2, 3);
    w.client().set_threshold(&w.admin, &3);

    assert!(!w.submit(&w.signers[0], 100, T0).finalized);
    assert!(!w.submit(&w.signers[1], 100, T0).finalized);
    assert!(w.submit(&w.signers[2], 100, T0).finalized);
}

#[test]
fn threshold_change_does_not_retroactively_finalize_pending_readings() {
    let w = setup(3, 3);
    w.submit(&w.signers[0], 100, T0);
    w.submit(&w.signers[1], 100, T0);

    // Lowering the bar does not silently settle the in-flight reading; the
    // final signature still has to be published on-chain.
    w.client().set_threshold(&w.admin, &1);
    assert!(!w.client().has_reading(&w.region_id));

    let outcome = w.submit(&w.signers[2], 100, T0);
    assert!(outcome.finalized);
    assert_eq!(outcome.approvals, 3);
}
