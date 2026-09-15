//! Bounded per-region history ring.

use super::{setup, T0, DAY};
use crate::MAX_HISTORY_PER_REGION;

#[test]
fn history_records_every_finalized_reading_in_order() {
    let w = setup(1, 1);

    w.submit(&w.signers[0], 500, T0);
    w.submit_at(&w.signers[0], 450, T0 + DAY);
    w.submit_at(&w.signers[0], 320, T0 + 2 * DAY);

    let history = w.client().get_index_history(&w.region_id);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().index_value, 500);
    assert_eq!(history.get(2).unwrap().index_value, 320);
    assert_eq!(history.get(2).unwrap().timestamp, T0 + 2 * DAY);
}

#[test]
fn history_is_capped_at_the_configured_ring_size() {
    let w = setup(1, 1);

    for step in 0..(MAX_HISTORY_PER_REGION + 5) {
        w.submit_at(&w.signers[0], 100 + step as i128, T0 + step as u64 * DAY);
    }

    let history = w.client().get_index_history(&w.region_id);
    assert_eq!(history.len(), MAX_HISTORY_PER_REGION);

    // The oldest entries were evicted, not the newest.
    assert_eq!(history.get(0).unwrap().timestamp, 5 * DAY + T0);
    assert_eq!(
        history
            .get(MAX_HISTORY_PER_REGION - 1)
            .unwrap()
            .timestamp,
        T0 + (MAX_HISTORY_PER_REGION + 4) as u64 * DAY
    );
}

#[test]
fn history_stays_in_sync_with_the_latest_reading() {
    let w = setup(2, 2);

    w.submit(&w.signers[0], 275, T0);
    w.submit(&w.signers[1], 275, T0);

    let latest = w.client().get_latest_index(&w.region_id);
    let history = w.client().get_index_history(&w.region_id);

    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap(), latest);
}

#[test]
fn each_region_grows_its_own_history() {
    let w = setup(1, 1);
    let other = w.other_region();

    w.submit(&w.signers[0], 100, T0);
    w.submit_at(&w.signers[0], 110, T0 + DAY);
    w.client().submit_index(&w.signers[0], &other, &130, &T0);

    assert_eq!(w.client().get_index_history(&w.region_id).len(), 2);
    assert_eq!(w.client().get_index_history(&other).len(), 1);
}

#[test]
fn readings_that_only_reached_a_pending_state_are_not_in_history() {
    let w = setup(2, 3);

    w.submit(&w.signers[0], 210, T0);

    assert!(w.client().get_index_history(&w.region_id).is_empty());
    assert!(!w.client().has_reading(&w.region_id));
}
