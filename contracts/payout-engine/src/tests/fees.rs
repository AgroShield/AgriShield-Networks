//! Fee guard for the settlement path.
//!
//! Settlement is the most expensive thing this system does: it crosses three
//! contract boundaries and is retried per policy, per keeper round. The cost that
//! used to dominate was not the calls themselves — it was the *shape* of one
//! fetch.
//!
//! A policy can only ever be decided by a reading inside its own coverage window,
//! and the oracle retains up to `MAX_HISTORY_PER_REGION` readings per region. The
//! engine used to ask for all of them and let the pure decision procedure discard
//! the rest, so every settlement attempt moved a season's worth of readings across
//! a contract boundary to throw most of them away.
//!
//! Measured on this suite, settling a policy in a region that is carrying a full
//! 64-reading history entirely outside that policy's window:
//!
//! | | history outside the window | |
//! |---|---|---|
//! | whole region history across the boundary | 1,940,118 | (+1375%) |
//! | the window only | 156,535 | (+19%) |
//!
//! The same settlement, on the same chain state, against a region carrying
//! nothing: 131,604 and 131,617. So the change did not make settlement cheap — it
//! made it stop depending on how long the region had been publishing, which is
//! the part that could only ever get worse.

use soroban_sdk::Env;

use crate::tests::{setup, World, T0, WINDOW_OPEN};

/// CPU instructions consumed by one invocation.
fn cpu_of(env: &Env, run: impl FnOnce()) -> u64 {
    env.cost_estimate().budget().reset_tracker();
    run();
    env.cost_estimate().budget().cpu_instruction_cost()
}

/// The hour the fill uses, so the last reading lands well before cover opens.
const HOUR: u64 = 3_600;

/// The clock both halves of the comparison run at, so both take the same branch.
const OBSERVED_AT: u64 = T0 + 65 * HOUR;

/// Publishes `count` readings that all fall *before* cover opens.
///
/// Retained by the oracle, and unusable by the policy by construction: a reading
/// outside the coverage window can never trigger a payment. That is exactly the
/// history a settlement should not have to pay to read.
fn fill_history_before_cover(w: &World, count: u32) {
    for i in 0..count {
        let timestamp = T0 + HOUR * (i as u64 + 1);
        assert!(
            timestamp < WINDOW_OPEN,
            "the fill has to stay before cover opens to stay out of the window"
        );
        w.publish(10, timestamp);
    }
}

/// Settling costs the same whether the region is publishing its first reading or
/// has a full retained history that the policy's window excludes.
///
/// The factor of two admits the index scan that remains — 64 timestamps read as
/// one small entry — and rejects the layout this replaced, which measured a
/// factor of nearly fifteen.
#[test]
fn settling_does_not_get_more_expensive_as_the_region_history_grows() {
    let bare = setup();
    let bare_policy = bare.create_default_policy();
    bare.at(OBSERVED_AT);
    let bare_cost = cpu_of(&bare.env, || {
        bare.settle(bare_policy);
    });

    let loaded = setup();
    let loaded_policy = loaded.create_default_policy();
    fill_history_before_cover(&loaded, 64);
    assert_eq!(
        loaded
            .oracle_client()
            .get_index_history(&loaded.region)
            .len(),
        64,
        "the region should be carrying a full history before the comparison"
    );
    loaded.at(OBSERVED_AT);
    let loaded_cost = cpu_of(&loaded.env, || {
        loaded.settle(loaded_policy);
    });

    assert!(
        loaded_cost < bare_cost * 2,
        "settlement grew with unrelated history: {bare_cost} -> {loaded_cost}"
    );
}

/// The windowed fetch returns exactly the in-window readings the full history
/// would have, which is what lets the decision procedure stay as it was.
///
/// The two calls are compared directly rather than the decision being trusted: a
/// cheaper fetch that returned a *different* set would settle differently, and
/// that is the failure this optimization could plausibly introduce.
#[test]
fn the_windowed_fetch_matches_the_full_history_inside_the_window() {
    let w = setup();
    // One reading before cover opens, and two inside it.
    w.publish(10, T0 + HOUR);
    w.publish(20, WINDOW_OPEN + HOUR);
    w.publish(30, WINDOW_OPEN + 2 * HOUR);

    let all = w.oracle_client().get_index_history(&w.region);
    let inside = w.oracle_client().get_index_history_between(
        &w.region,
        &WINDOW_OPEN,
        &(WINDOW_OPEN + 10 * HOUR),
    );

    assert_eq!(all.len(), 3);
    assert_eq!(
        inside.len(),
        2,
        "the out-of-window reading must not be returned"
    );
    assert_eq!(inside.get(0).unwrap().timestamp, WINDOW_OPEN + HOUR);
    assert_eq!(inside.get(1).unwrap().timestamp, WINDOW_OPEN + 2 * HOUR);
    // The window is half-open, so a reading at exactly `end` belongs to the next
    // window rather than this one — the boundary the trigger rule also relies on.
    let empty = w
        .oracle_client()
        .get_index_history_between(&w.region, &T0, &(T0 + HOUR));
    assert!(empty.is_empty(), "the window excludes its closing instant");
}
