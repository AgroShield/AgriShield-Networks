//! Coverage-window validation: boundaries, minimum length and retroactive cover.

use super::{setup, PolicySpec, T0, DAY};
use crate::{MAX_COVERAGE_WINDOW, MIN_COVERAGE_WINDOW};

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn rejects_end_before_start() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + 60 * DAY, T0 + DAY);
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn rejects_zero_length_window() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + DAY);
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn rejects_window_shorter_than_the_minimum() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + DAY + MIN_COVERAGE_WINDOW - 1);
    w.create(&spec);
}

#[test]
fn accepts_window_exactly_at_the_minimum() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + DAY + MIN_COVERAGE_WINDOW);

    let id = w.create(&spec);

    assert!(w.registry_client().is_active(&id));
}

#[test]
fn accepts_window_exactly_at_the_maximum() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + DAY + MAX_COVERAGE_WINDOW);

    let id = w.create(&spec);

    assert!(w.registry_client().is_active(&id));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn rejects_window_longer_than_the_maximum() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + DAY + MAX_COVERAGE_WINDOW + 1);
    w.create(&spec);
}

#[test]
fn accepts_window_that_starts_exactly_now() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0, T0 + 30 * DAY);

    let id = w.create(&spec);

    assert!(w.registry_client().is_active(&id));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn rejects_retroactive_cover_starting_yesterday() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 - DAY, T0 + 30 * DAY);
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn rejects_window_that_already_closed() {
    let w = setup();
    let spec = PolicySpec::new(&w.env).covering(T0 - 60 * DAY, T0 - DAY);
    w.create(&spec);
}

#[test]
fn accepts_next_season_window_after_previous_one_expires() {
    let w = setup();
    let first = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 90 * DAY);
    let id = w.create(&first);

    // Roll the clock past the first window and sell the next season on the
    // same plot: the overlap guard must not block non-overlapping cover.
    w.at(T0 + 90 * DAY + 1);
    let second = PolicySpec::new(&w.env).covering(T0 + 91 * DAY, T0 + 181 * DAY);
    let next_id = w.create(&second);

    assert_eq!((id, next_id), (1, 2));
}
