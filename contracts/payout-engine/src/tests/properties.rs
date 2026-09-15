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
/// instant lies inside the window reports an index at or below the threshold.
///
/// Deliberately written without looking at the implementation's structure — it
/// enumerates rather than scans, so it cannot inherit the same off-by-one.
fn any_qualifying(entries: &[Observation], start: u64, end: u64, threshold: i128) -> bool {
    entries.iter().any(|(index_value, timestamp)| {
        *timestamp >= start && *timestamp <= end && *index_value <= threshold
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
            *timestamp >= start && *timestamp <= end && *index_value <= threshold
        })
        .map(|(_, timestamp)| *timestamp)
        .min()
}

fn decide(entries: &[Observation], setup: Setup) -> Decision {
    let env = Env::default();
    let ((start, end), threshold, now) = setup;
    evaluate_terms(&to_history(&env, entries), start, end, threshold, now)
}

proptest! {
    /// The decision is exactly the reference rule, everywhere.
    #[test]
    fn the_decision_always_matches_the_reference_rule(
        entries in prop::collection::vec(observation(), 0..12),
        ((start, end), threshold, now) in setup(),
    ) {
        let qualifying = any_qualifying(&entries, start, end, threshold);

        let expected = if qualifying {
            SettlementStatus::Paid
        } else if now > end {
            // Only strictly past the end of cover: on the closing instant
            // itself an observation could still arrive.
            SettlementStatus::Expired
        } else {
            SettlementStatus::Pending
        };

        prop_assert_eq!(decide(&entries, ((start, end), threshold, now)).status(), expected);
    }

    /// Anything the engine pays out on is genuinely inside the coverage window
    /// and genuinely at or below the threshold.
    #[test]
    fn a_triggered_reading_is_always_a_real_breach_inside_the_window(
        entries in prop::collection::vec(observation(), 0..12),
        ((start, end), threshold, _now) in setup(),
    ) {
        let env = Env::default();
        if let Some(reading) = find_trigger(&to_history(&env, &entries), start, end, threshold) {
            prop_assert!(reading.timestamp >= start && reading.timestamp <= end);
            prop_assert!(reading.index_value <= threshold);
        }
    }

    /// The payout is anchored to the first breach, so it cannot depend on how
    /// many observations happened to arrive afterwards.
    #[test]
    fn the_earliest_breach_decides(mut entries in prop::collection::vec(observation(), 1..12),
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
    fn observations_outside_the_window_cannot_change_the_decision(
        entries in prop::collection::vec(observation(), 0..12),
        ((start, end), threshold, now) in setup(),
    ) {
        let inside_only: std::vec::Vec<Observation> = entries
            .iter()
            .copied()
            .filter(|(_, timestamp)| *timestamp >= start && *timestamp <= end)
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
}
