//! Fee guards for the submission path.
//!
//! Soroban charges for the work an invocation does, and this is the path that
//! runs most often: once per signer, per reading, for every region. So it is the
//! one worth pinning.
//!
//! These assertions exist because the obvious implementation is the expensive
//! one. History was originally a single `Vec<IndexReading>` per region, so every
//! submission read the whole retained history to answer "is this timestamp
//! already finalized?", and every finalization rewrote it. Storing one entry per
//! retained instant, plus a small index of their timestamps, is what these tests
//! defend.
//!
//! Measured on this suite, with the ring at its cap of
//! `MAX_HISTORY_PER_REGION` readings:
//!
//! | submission on a region with… | `Vec` of readings | one entry per instant |
//! |---|---|---|
//! | 1 reading  | 167,142 | 161,288 |
//! | 64 readings | 1,158,557 | 541,698 |
//!
//! The telemetry is CPU instructions, which the test budget meters
//! deterministically — it is a counter over host calls and wasm instructions,
//! not wall-clock time, so the figures are stable across machines.

use soroban_sdk::Env;

use crate::tests::{setup, OracleWorld, T0};
use crate::MAX_HISTORY_PER_REGION;

/// CPU instructions consumed by one invocation.
///
/// The tracker is reset immediately before the call and read immediately after,
/// so the figure is that call's own cost rather than an accumulation of whatever
/// ran before it.
fn cpu_of(env: &Env, run: impl FnOnce()) -> u64 {
    env.cost_estimate().budget().reset_tracker();
    run();
    env.cost_estimate().budget().cpu_instruction_cost()
}

/// One hour, the spacing the readings in these tests use.
const HOUR: u64 = 3_600;

/// A world with a single finalized reading already on the books.
///
/// The warm-up matters: reading `Latest` decodes a stored reading and bumps its
/// TTL, so a comparison against a world that has never published anything would
/// be measuring "is there a `Latest` entry" rather than "how big is the history".
/// Threshold 1 keeps every submission below a finalization, so the ring grows
/// predictably.
fn warmed() -> OracleWorld {
    let w = setup(1, 1);
    w.submit_at(&w.signers[0], 1, T0 + HOUR);
    w
}

/// Sends `count` further readings, starting `from` hours past the fixed clock.
fn fill_history(w: &OracleWorld, count: u32, from: u64) {
    for i in 0..count {
        let timestamp = T0 + HOUR * (from + i as u64);
        w.submit_at(&w.signers[0], i as i128, timestamp);
    }
}

/// The first free hour after a full ring.
fn past_the_ring() -> u64 {
    T0 + HOUR * (2 + MAX_HISTORY_PER_REGION as u64 + 1)
}

/// A submission costs a small multiple of itself when the region keeps the
/// maximum history instead of a single reading.
///
/// The multiple is the point. Readings are never read on this path, so what
/// remains is the ring's index of timestamps — 64 `u64`s, not 64 readings. The
/// factor of five is chosen to admit that index and to reject the layout this
/// replaced: measured, the `Vec`-of-readings version grew the same submission by
/// a factor of ~6.9 and blew the assertion.
#[test]
fn a_submission_does_not_get_more_expensive_as_history_grows() {
    let small = warmed();
    let small_ring = cpu_of(&small.env, || {
        small.submit_at(&small.signers[0], 2, T0 + 2 * HOUR);
    });

    let full = warmed();
    fill_history(&full, MAX_HISTORY_PER_REGION, 2);
    assert_eq!(
        full.client().get_index_history(&full.region_id).len(),
        MAX_HISTORY_PER_REGION,
        "the ring should be full before the comparison"
    );

    let full_ring = cpu_of(&full.env, || {
        full.submit_at(&full.signers[0], 3, past_the_ring());
    });

    assert!(
        full_ring < small_ring * 5,
        "a submission over a full ring ({full_ring}) should stay within a small \
         multiple of one over a single reading ({small_ring})"
    );
}

/// A submission stays inside a budget a signer can afford to pay.
#[test]
fn a_finalizing_submission_costs_a_bounded_amount_of_cpu() {
    let w = warmed();
    let cost = cpu_of(&w.env, || {
        w.submit_at(&w.signers[0], 2, T0 + 2 * HOUR);
    });

    assert!(cost < 250_000, "a submission cost {cost} CPU instructions");
}

/// The busiest realistic case — a settled region at its history cap — is still
/// bounded. This is the ceiling the previous layout failed by more than 2x.
#[test]
fn a_finalizing_submission_with_a_full_ring_stays_bounded() {
    let w = warmed();
    fill_history(&w, MAX_HISTORY_PER_REGION, 2);

    let cost = cpu_of(&w.env, || {
        w.submit_at(&w.signers[0], 9, past_the_ring());
    });

    assert!(
        cost < 700_000,
        "a submission over a full ring cost {cost} CPU instructions"
    );
}
