//! The pure decision table: when does an index breach pay?
//!
//! These drive [`crate::trigger`] directly, with no contracts deployed, so the
//! rule itself can be checked exhaustively — including the window and threshold
//! boundaries that are expensive to arrange on chain.

use soroban_sdk::{Env, Symbol, Vec};

use super::{DAY, T0};
use crate::trigger::{evaluate_terms, find_trigger, Decision};
use crate::{IndexReading, SettlementStatus};

const OPEN: u64 = T0 + 10 * DAY;
const CLOSE: u64 = OPEN + 30 * DAY;
const THRESHOLD: i128 = 300;

fn reading(env: &Env, index_value: i128, timestamp: u64) -> IndexReading {
    IndexReading {
        region_id: Symbol::new(env, "ng_kaduna"),
        index_value,
        timestamp,
        finalized_at: timestamp,
        approvals: 1,
    }
}

/// Builds an oldest-first history, the order the oracle returns.
fn history(env: &Env, entries: &[(i128, u64)]) -> Vec<IndexReading> {
    let mut out = Vec::new(env);
    for (index_value, timestamp) in entries.iter() {
        out.push_back(reading(env, *index_value, *timestamp));
    }
    out
}

fn decide(entries: &[(i128, u64)], now: u64) -> Decision {
    let env = Env::default();
    evaluate_terms(&history(&env, entries), OPEN, CLOSE, THRESHOLD, now)
}

#[test]
fn a_breach_inside_the_window_triggers() {
    let decision = decide(&[(900, OPEN - DAY), (120, OPEN + 5 * DAY)], CLOSE - DAY);

    assert_eq!(decision.status(), SettlementStatus::Paid);
    assert_eq!(decision.reading().unwrap().index_value, 120);
}

#[test]
fn a_reading_exactly_at_the_threshold_triggers() {
    // The threshold is inclusive: "300mm or less" is the product, not "less
    // than 300mm", and an off-by-one here would deny a legitimate claim.
    let decision = decide(&[(THRESHOLD, OPEN + DAY)], CLOSE - DAY);

    assert_eq!(decision.status(), SettlementStatus::Paid);
}

#[test]
fn a_reading_just_above_the_threshold_does_not_trigger() {
    let decision = decide(&[(THRESHOLD + 1, OPEN + DAY)], CLOSE - DAY);

    assert_eq!(decision.status(), SettlementStatus::Pending);
}

#[test]
fn cover_includes_its_opening_edge() {
    // A drought observed on the first instant of cover is covered.
    assert_eq!(
        decide(&[(50, OPEN)], CLOSE).status(),
        SettlementStatus::Paid,
        "a breach on the opening day must count"
    );
}

#[test]
fn cover_excludes_its_closing_edge() {
    // The window is `[coverage_start, coverage_end)`: the closing instant
    // belongs to the *next* window, not this one. The registry only rejects
    // *overlapping* windows, so a back-to-back renewal on the same plot is a
    // legal pair of policies — and if both claimed this instant, one reading
    // would pay twice.
    assert_eq!(
        decide(&[(50, CLOSE)], CLOSE + 1).status(),
        SettlementStatus::Expired,
        "the closing instant is not covered"
    );
    assert!(decide(&[(50, CLOSE)], CLOSE + 1).reading().is_none());
}

#[test]
fn a_boundary_breach_pays_the_later_policy_exactly_once() {
    // The same instant, seen from either side of the shared edge.
    let env = Env::default();
    let entries = history(&env, &[(50, CLOSE)]);

    // The policy that ends at CLOSE does not cover it.
    assert!(find_trigger(&entries, OPEN, CLOSE, THRESHOLD).is_none());
    // The renewal that starts at CLOSE does.
    assert!(find_trigger(&entries, CLOSE, CLOSE + 30 * DAY, THRESHOLD).is_some());
}

#[test]
fn a_breach_before_cover_began_is_ignored() {
    // The drought predates the policy: no cover, no claim. Without this the
    // farmer could simply wait for the next dry spell and buy it retroactively.
    let decision = decide(&[(50, OPEN - 1)], CLOSE - DAY);

    assert_eq!(decision.status(), SettlementStatus::Pending);
    assert!(decision.reading().is_none());
}

#[test]
fn a_breach_after_cover_closed_is_ignored() {
    let decision = decide(&[(50, CLOSE + 1)], CLOSE + DAY);

    assert_eq!(decision.status(), SettlementStatus::Expired);
    assert!(decision.reading().is_none());
}

#[test]
fn an_open_window_without_a_breach_is_pending() {
    let decision = decide(&[(900, OPEN + DAY)], CLOSE - DAY);

    assert_eq!(decision.status(), SettlementStatus::Pending);
}

#[test]
fn a_closed_window_without_a_breach_is_expired() {
    let decision = decide(&[(900, CLOSE - DAY)], CLOSE + 1);

    assert_eq!(decision.status(), SettlementStatus::Expired);
}

#[test]
fn a_closed_window_expires_once_the_clock_is_past_it() {
    // No future reading can be timestamped inside `[OPEN, CLOSE)` once the clock
    // is at CLOSE, so the policy is dead at that instant — but the registry only
    // opens expiry strictly after the window, so the decision has to wait for it.
    // Reporting `Expired` at CLOSE would name a transition the registry refuses,
    // which is exactly the disagreement settlement must never have.
    assert_eq!(
        decide(&[(900, OPEN + DAY)], CLOSE).status(),
        SettlementStatus::Pending
    );
    assert_eq!(
        decide(&[(900, OPEN + DAY)], CLOSE + 1).status(),
        SettlementStatus::Expired
    );
}

#[test]
fn a_closed_window_without_any_reading_is_expired() {
    // The oracle never published for this region. Nothing can appear inside a
    // window that has already passed, so the policy is dead regardless.
    let decision = decide(&[], CLOSE + 1);

    assert_eq!(decision.status(), SettlementStatus::Expired);
}

#[test]
fn the_earliest_qualifying_reading_decides() {
    // Two observations breached the threshold; the first one is the claim, so
    // the payout cannot depend on how many readings arrived afterwards.
    let entries = [(120, OPEN + DAY), (80, OPEN + 2 * DAY)];
    let decision = decide(&entries, CLOSE - DAY);

    assert_eq!(decision.reading().unwrap().index_value, 120);
    assert_eq!(decision.reading().unwrap().timestamp, OPEN + DAY);
}

#[test]
fn find_trigger_reports_no_match_for_a_history_with_out_of_window_breaches() {
    let env = Env::default();
    let entries = history(&env, &[(50, OPEN - DAY), (50, CLOSE + DAY)]);

    assert!(find_trigger(&entries, OPEN, CLOSE, THRESHOLD).is_none());
}
