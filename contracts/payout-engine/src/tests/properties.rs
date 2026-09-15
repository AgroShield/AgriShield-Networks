//! Property tests for the trigger rule.
//!
//! [`super::trigger`] pins the decision by hand at the boundaries that matter.
//! These tests attack the same rule from the other direction: they generate
//! arbitrary region histories, coverage windows and ledger clocks, then check
//! every decision against an independently written reference implementation.
//! The cases hand-written tests tend to miss are exactly the ones a generator
//! produces for free — a reading stamped in the future relative to the ledger
//! clock, several readings claiming the same instant, a window the clock has
//! not reached yet, or a history that is not sorted at all.
//!
//! One generator detail is load-bearing. A coverage window spans days and is
//! compared against second-resolution timestamps, so a reading sampled uniformly
//! across the window lands *exactly* on its edge with probability on the order of
//! one in a million. Properties about the edges therefore plant their readings a
//! known distance from the edge instead (see [`offset_from_start`]); a
//! uniformly-generated boundary property is one that cannot fail, and a test that
//! cannot fail is not a test.
//!
//! When a case fails, proptest shrinks it to a minimal reproduction before
//! reporting it.

use proptest::prelude::*;
use soroban_sdk::{Env, Symbol, Vec};

use super::DAY;
use crate::trigger::{evaluate_terms, find_trigger, Decision};
use crate::{IndexReading, SettlementStatus};

/// Bounds wide enough to cross the window in both directions, and to let the
/// clock sit before, inside and after it.
const MAX_TIME: u64 = 8 * DAY;

/// Index values the oracle would accept (its sanity band is `0..=5_000`), so
/// generated histories look like ones that could really be finalized.
const MAX_INDEX: i128 = 5_000;

/// One observation: an index value and the instant it describes.
type Observation = (i128, u64);

/// A window, a threshold and a ledger clock to decide against.
type Setup = ((u64, u64), i128, u64);

fn observation() -> impl Strategy<Value = Observation> {
    (0i128..=MAX_INDEX, 0u64..MAX_TIME)
}

fn setup() -> impl Strategy<Value = Setup> {
    (
        (0u64..MAX_TIME, 0u64..MAX_TIME),
        0i128..=MAX_INDEX,
        0u64..MAX_TIME,
    )
        .prop_map(|((a, b), threshold, now)| {
            let (start, end) = if a <= b { (a, b) } else { (b, a) };
            ((start, end), threshold, now)
        })
}

fn to_history(env: &Env, entries: &[Observation]) -> Vec<IndexReading> {
    let mut out = Vec::new(env);
    for (index_value, timestamp) in entries.iter() {
        out.push_back(IndexReading {
            region_id: Symbol::new(env, "ng_kaduna"),
            index_value: *index_value,
            timestamp: *timestamp,
            finalized_at: *timestamp,
            approvals: 1,
        });
    }
    out
}

/// The rule restated from scratch: a claim is due when *some* observation whose
/// instant lies inside the half-open window `[start, end)` reports an index at
/// or below the threshold.
///
/// Deliberately written without looking at the implementation's structure — it
/// enumerates rather than scans, so it cannot inherit the same off-by-one.
fn any_qualifying(entries: &[Observation], start: u64, end: u64, threshold: i128) -> bool {
    entries.iter().any(|(index_value, timestamp)| {
        *timestamp >= start && *timestamp < end && *index_value <= threshold
    })
}

/// The earliest instant at which a qualifying observation was reported.
fn earliest_qualifying_at(
    entries: &[Observation],
    start: u64,
    end: u64,
    threshold: i128,
) -> Option<u64> {
    entries
        .iter()
        .filter(|(index_value, timestamp)| {
            *timestamp >= start && *timestamp < end && *index_value <= threshold
        })
        .map(|(_, timestamp)| *timestamp)
        .min()
}

fn decide(entries: &[Observation], setup: Setup) -> Decision {
    let env = Env::default();
    let ((start, end), threshold, now) = setup;
    evaluate_terms(&to_history(&env, entries), start, end, threshold, now)
}

/// How far from the window's opening edge a reading is planted, in seconds.
///
/// Drawn from three bands: straddling the opening edge, straddling the closing
/// edge, and anywhere in between. Bands rather than points, so a case that
/// misses the edge by one second is generated alongside the case that hits it.
fn offset_from_start(width: u64) -> impl Strategy<Value = i64> {
    let last = i64::try_from(width).unwrap_or(i64::MAX);
    prop_oneof![-3i64..=3, (last - 3)..=(last + 3), -3i64..=(last + 3)]
}

/// Places a reading `offset` seconds from `start`, saturated at the epoch.
fn place(start: u64, offset: i64) -> u64 {
    start.saturating_add_signed(offset)
}

/// A window, a threshold, a clock, and readings planted relative to the edges.
fn edge_setup() -> impl Strategy<Value = (Setup, std::vec::Vec<Observation>)> {
    (
        0u64..MAX_TIME,
        0u64..MAX_TIME,
        0i128..=MAX_INDEX,
        0u64..MAX_TIME,
    )
        .prop_flat_map(|(a, b, threshold, now)| {
            let (start, end) = if a <= b { (a, b) } else { (b, a) };
            let width = end - start;
            let entries =
                prop::collection::vec((0i128..=MAX_INDEX, offset_from_start(width)), 0..12)
                    .prop_map(move |raw| {
                        raw.into_iter()
                            .map(|(index, offset)| (index, place(start, offset)))
                            .collect::<std::vec::Vec<Observation>>()
                    });
            (Just(((start, end), threshold, now)), entries)
        })
}

proptest! {
    /// The decision is exactly the reference rule, everywhere — including the
    /// instants sitting on the window's edges.
    #[test]
    fn the_decision_always_matches_the_reference_rule((setup, entries) in edge_setup()) {
        let ((start, end), threshold, now) = setup;

        let expected = if any_qualifying(&entries, start, end, threshold) {
            SettlementStatus::Paid
        } else if now > end {
            // Cover has ended, and the registry's expiry gate has opened with
            // it: no observation published from here on can be timestamped
            // inside `[start, end)`, so the policy can never pay.
            SettlementStatus::Expired
        } else {
            SettlementStatus::Pending
        };

        prop_assert_eq!(decide(&entries, setup).status(), expected);
    }

    /// Anything the engine pays out on is genuinely inside the coverage window
    /// and genuinely at or below the threshold — the closing instant included in
    /// the "outside" half of that claim.
    #[test]
    fn a_triggered_reading_is_always_a_real_breach_inside_the_window(
        (setup, entries) in edge_setup(),
    ) {
        let ((start, end), threshold, _now) = setup;
        let env = Env::default();

        if let Some(reading) = find_trigger(&to_history(&env, &entries), start, end, threshold) {
            prop_assert!(reading.timestamp >= start && reading.timestamp < end);
            prop_assert!(reading.index_value <= threshold);
        }
    }

    /// The payout is anchored to the first breach, so it cannot depend on how
    /// many observations happened to arrive afterwards.
    #[test]
    fn the_earliest_breach_decides(
        mut entries in prop::collection::vec(observation(), 1..12),
        ((start, end), threshold, _now) in setup(),
    ) {
        entries.sort_by_key(|(_, timestamp)| *timestamp);
        let expected = earliest_qualifying_at(&entries, start, end, threshold);
        let decision = decide(&entries, ((start, end), threshold, _now));

        match (expected, decision.reading()) {
            (Some(timestamp), Some(reading)) => prop_assert_eq!(reading.timestamp, timestamp),
            (None, None) => {}
            _ => prop_assert!(false, "decision disagreed about whether cover triggered"),
        }
    }

    /// Once cover has breached, the ledger clock is irrelevant: settlement pays
    /// a claim that has already happened no matter what the clock says.
    #[test]
    fn a_breach_pays_regardless_of_the_clock(
        entries in prop::collection::vec(observation(), 0..12),
        (start, end) in (0u64..MAX_TIME, 0u64..MAX_TIME),
        threshold in 0i128..=MAX_INDEX,
        clocks in prop::collection::vec(0u64..MAX_TIME, 1..6),
    ) {
        let (start, end) = if start <= end { (start, end) } else { (end, start) };
        prop_assume!(any_qualifying(&entries, start, end, threshold));

        for now in clocks {
            prop_assert_eq!(
                decide(&entries, ((start, end), threshold, now)).status(),
                SettlementStatus::Paid
            );
        }
    }

    /// Observations outside the window are invisible. Stripping them out must
    /// not change the decision — which is what makes retroactive cover useless.
    #[test]
    fn observations_outside_the_window_cannot_change_the_decision((setup, entries) in edge_setup()) {
        let ((start, end), threshold, now) = setup;
        let inside_only: std::vec::Vec<Observation> = entries
            .iter()
            .copied()
            .filter(|(_, timestamp)| *timestamp >= start && *timestamp < end)
            .collect();

        prop_assert_eq!(
            decide(&entries, ((start, end), threshold, now)).status(),
            decide(&inside_only, ((start, end), threshold, now)).status()
        );
    }

    /// Duplicating an observation is a no-op. The oracle finalizes one reading
    /// per instant, but a replay or a retry must not turn one breach into two
    /// claims or move the moment the claim is anchored to.
    #[test]
    fn duplicating_a_reading_changes_nothing(
        entries in prop::collection::vec(observation(), 0..12),
        ((start, end), threshold, now) in setup(),
    ) {
        let mut duplicated = entries.clone();
        duplicated.extend(entries.iter().copied());

        let once = decide(&entries, ((start, end), threshold, now));
        let twice = decide(&duplicated, ((start, end), threshold, now));

        prop_assert_eq!(once.status(), twice.status());
        prop_assert_eq!(
            once.reading().map(|reading| reading.timestamp),
            twice.reading().map(|reading| reading.timestamp)
        );
    }

    /// The instant where two windows meet belongs to the later one.
    ///
    /// The registry permits back-to-back policies on the same plot, because it
    /// only rejects *overlapping* windows. Were both windows to include the
    /// instant they meet at, a single finalized reading would pay both policies:
    /// double cover bought for a single premium, and up to
    /// `MAX_POLICIES_PER_PLOT` times the payout for one drought.
    #[test]
    fn the_instant_two_windows_meet_belongs_to_the_later_one(
        (start, width) in (0u64..MAX_TIME, 1u64..MAX_TIME),
        threshold in 0i128..=MAX_INDEX,
        index in 0i128..=MAX_INDEX,
    ) {
        // A reading planted exactly on the shared instant, and one that breaches.
        prop_assume!(index <= threshold);

        // The earlier window ends where the later one begins.
        let mid = start + width;
        let env = Env::default();
        let readings = to_history(&env, &[(index, mid)]);

        prop_assert!(
            find_trigger(&readings, start, mid, threshold).is_none(),
            "a reading at the shared instant was covered by the earlier window too"
        );
        prop_assert!(
            find_trigger(&readings, mid, mid + width, threshold).is_some(),
            "a reading at the shared instant must fall inside the later window"
        );
    }
}
