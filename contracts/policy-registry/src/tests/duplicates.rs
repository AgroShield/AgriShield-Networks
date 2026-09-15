//! Dynamic-weather-proofing guard: a plot may never carry two overlapping
//! `Active` policies.

use super::{setup, PolicySpec, DAY, T0};
use crate::{MAX_POLICIES_PER_PLOT, MIN_COVERAGE_WINDOW};

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn rejects_identical_window_on_the_same_plot() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);

    w.create(&spec);
    w.create(&spec);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn rejects_window_overlapping_the_start_of_an_existing_policy() {
    let w = setup();
    let existing = PolicySpec::new(&w.env).covering(T0 + 10 * DAY, T0 + 40 * DAY);
    w.create(&existing);

    let overlapping = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 20 * DAY);
    w.create(&overlapping);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn rejects_window_overlapping_the_end_of_an_existing_policy() {
    let w = setup();
    let existing = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 40 * DAY);
    w.create(&existing);

    let overlapping = PolicySpec::new(&w.env).covering(T0 + 30 * DAY, T0 + 60 * DAY);
    w.create(&overlapping);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn rejects_window_fully_containing_an_existing_policy() {
    let w = setup();
    let existing = PolicySpec::new(&w.env).covering(T0 + 10 * DAY, T0 + 20 * DAY);
    w.create(&existing);

    // A longer, nested window is still double cover on the same plot.
    let nested = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 60 * DAY);
    w.create(&nested);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")]
fn rejects_window_fully_contained_by_an_existing_policy() {
    let w = setup();
    let existing = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 60 * DAY);
    w.create(&existing);

    let nested = PolicySpec::new(&w.env).covering(T0 + 10 * DAY, T0 + 20 * DAY);
    w.create(&nested);
}

#[test]
fn allows_windows_that_only_touch_at_the_boundary() {
    let w = setup();
    let first = PolicySpec::new(&w.env).covering(T0 + DAY, T0 + 30 * DAY);
    let second = PolicySpec::new(&w.env).covering(T0 + 30 * DAY, T0 + 60 * DAY);

    let a = w.create(&first);
    let b = w.create(&second);

    assert_eq!((a, b), (1, 2));
}

#[test]
fn allows_the_same_window_on_different_plots() {
    let w = setup();
    let first = PolicySpec::new(&w.env);
    let second = PolicySpec::new(&w.env).on_plot(w.plot(2));

    let a = w.create(&first);
    let b = w.create(&second);

    assert_eq!((a, b), (1, 2));
}

#[test]
fn allows_a_new_policy_on_the_same_window_after_settlement() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);

    // The engine settles the claim; the window is no longer live cover.
    w.registry_client().mark_settled(&w.engine, &first);

    let second = w.create(&spec);

    assert_eq!(second, 2);
}

#[test]
fn allows_a_new_policy_on_the_same_window_after_cancellation() {
    let w = setup();
    let spec = PolicySpec::new(&w.env);
    let first = w.create(&spec);

    w.registry_client().cancel_policy(&first);
    let second = w.create(&spec);

    assert_eq!(second, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")]
fn caps_the_number_of_policies_per_plot() {
    let w = setup();
    // Enough premium for every policy in the loop plus the rejected one.
    w.mint(&w.farmer, 1_000_000);

    for index in 0..MAX_POLICIES_PER_PLOT {
        let start = T0 + (index as u64) * (MIN_COVERAGE_WINDOW + DAY);
        w.at(start);
        let spec = PolicySpec::new(&w.env).covering(start, start + MIN_COVERAGE_WINDOW);
        w.create(&spec);
    }

    // The 33rd policy on the same plot trips the anti-growth cap. Its window
    // must sit after the last one, otherwise the overlap guard fires first.
    let start = T0 + (MAX_POLICIES_PER_PLOT as u64) * (MIN_COVERAGE_WINDOW + DAY);
    w.at(start);
    w.create(&PolicySpec::new(&w.env).covering(start, start + MIN_COVERAGE_WINDOW));
}
