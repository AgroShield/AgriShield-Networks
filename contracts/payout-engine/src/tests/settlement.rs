//! Settlement against the whole stack: payout, expiry and liability.
//!
//! Every test here drives real contracts — the engine reads a real policy, a
//! real oracle reading and really moves tokens out of the pool — so the
//! assertions about balances and policy status are assertions about the system,
//! not about a stub.

use policy_registry::PolicyStatus as RegistryStatus;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use super::{setup, DAY, PAYOUT, PREMIUM, THRESHOLD, WINDOW_CLOSE, WINDOW_OPEN};
use crate::SettlementStatus;

// ---------------------------------------------------------------------------
// Paying a claim
// ---------------------------------------------------------------------------

#[test]
fn a_triggered_policy_pays_the_farmer() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);
    assert_eq!(w.pool_client().outstanding_liability(), PAYOUT);

    w.publish(120, WINDOW_OPEN + 5 * DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Paid);
    assert_eq!(outcome.paid_amount, PAYOUT);
    assert_eq!(outcome.index_value, 120);
    assert_eq!(outcome.reading_timestamp, WINDOW_OPEN + 5 * DAY);

    assert_eq!(w.token_client().balance(&w.farmer), PAYOUT);
    assert_eq!(w.pool_client().reserves(), super::CAPITAL - PAYOUT);
    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(
        w.registry_client().get_policy(&policy_id).status,
        RegistryStatus::Settled
    );
    assert!(!w.engine_client().liability_registered(&policy_id));
}

#[test]
fn the_engine_settles_a_policy_it_never_registered_liability_for() {
    let w = setup();
    let policy_id = w.create_default_policy();

    // A policy whose cover was never registered still has to be payable: the
    // farmer's entitlement does not depend on an operator having run the
    // bookkeeping step.
    w.publish(120, WINDOW_OPEN + 5 * DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Paid);
    assert_eq!(w.token_client().balance(&w.farmer), PAYOUT);
    // The payout recognised and then released the same amount, so the pool is
    // not left carrying phantom liability for a policy it has already settled.
    assert_eq!(w.pool_client().outstanding_liability(), 0);
}

#[test]
fn settling_one_policy_does_not_consume_another_policys_cover() {
    let w = setup();

    // Two policies, one window, different plots. Only the first has its
    // liability on the pool's books.
    let tracked = w.create_policy(0, THRESHOLD, PAYOUT, PREMIUM, WINDOW_OPEN, WINDOW_CLOSE);
    let untracked = w.create_policy(1, THRESHOLD, PAYOUT, PREMIUM, WINDOW_OPEN, WINDOW_CLOSE);
    w.engine_client().register_liability(&tracked);
    assert_eq!(w.pool_client().outstanding_liability(), PAYOUT);

    w.publish(120, WINDOW_OPEN + 5 * DAY);
    assert_eq!(w.settle(untracked).status, SettlementStatus::Paid);

    // Paying the untracked policy recognised its payout first, so the tracked
    // policy's cover is exactly where it was.
    assert_eq!(w.pool_client().outstanding_liability(), PAYOUT);
    assert_eq!(w.token_client().balance(&w.farmer), PAYOUT);
}

#[test]
fn fresh_capital_after_a_payout_restores_the_pool() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(120, WINDOW_OPEN + 5 * DAY);
    w.settle(policy_id);
    assert_eq!(w.pool_client().reserves(), super::CAPITAL - PAYOUT);

    // The next season's premium income tops the pool back up, so a paid claim
    // does not permanently shrink the capital available to the region.
    w.fund_pool(PREMIUM);

    assert_eq!(
        w.pool_client().reserves(),
        super::CAPITAL - PAYOUT + PREMIUM
    );
}

// ---------------------------------------------------------------------------
// Deciding not to pay
// ---------------------------------------------------------------------------

#[test]
fn a_reading_above_the_threshold_leaves_the_policy_pending() {
    let w = setup();
    let policy_id = w.create_default_policy();

    w.publish(900, WINDOW_OPEN + 5 * DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Pending);
    assert_eq!(outcome.paid_amount, 0);
    assert_eq!(w.token_client().balance(&w.farmer), 0);
    assert!(w.registry_client().is_active(&policy_id));
    assert_eq!(w.pool_client().reserves(), super::CAPITAL);
}

#[test]
fn a_breach_before_cover_began_cannot_trigger_a_payout() {
    let w = setup();
    let policy_id = w.create_default_policy();

    // The drought happened before the policy was sold. Recognising it would let
    // a farmer buy cover retroactively against weather they have already seen.
    w.publish(50, WINDOW_OPEN - 2 * DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Pending);
    assert_eq!(w.token_client().balance(&w.farmer), 0);
}

#[test]
fn a_breach_after_the_window_closed_expires_rather_than_pays() {
    let w = setup();
    let policy_id = w.create_default_policy();

    // The rain failed *after* cover ended, so nothing is owed on this policy.
    w.publish(50, WINDOW_CLOSE + 2 * DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Expired);
    assert_eq!(w.token_client().balance(&w.farmer), 0);
}

#[test]
fn a_closed_window_without_a_breach_expires_the_policy() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);

    w.publish(900, WINDOW_OPEN + 5 * DAY);
    w.at(WINDOW_CLOSE + DAY);
    let outcome = w.settle(policy_id);

    assert_eq!(outcome.status, SettlementStatus::Expired);
    assert_eq!(outcome.paid_amount, 0);
    assert_eq!(
        w.registry_client().get_policy(&policy_id).status,
        RegistryStatus::Expired
    );
    // Nothing is owed any more, so the pool stops reserving the capital.
    assert_eq!(w.pool_client().outstanding_liability(), 0);
}

#[test]
fn the_deterministic_expiry_path_works_without_any_reading() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);
    w.at(WINDOW_CLOSE + DAY);

    // A keeper can force the closed-window path without waiting for the region's
    // readings to age out of the oracle's bounded history.
    w.engine_client().expire_policy(&policy_id);

    assert_eq!(
        w.registry_client().get_policy(&policy_id).status,
        RegistryStatus::Expired
    );
    assert_eq!(w.pool_client().outstanding_liability(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn expiring_before_the_window_closes_is_rejected() {
    let w = setup();
    let policy_id = w.create_default_policy();

    w.engine_client().expire_policy(&policy_id);
}

#[test]
fn settling_at_the_closing_instant_reports_pending_instead_of_failing() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(900, WINDOW_OPEN + DAY);
    w.at(WINDOW_CLOSE);

    // At exactly `coverage_end` the policy can never pay, but the registry's
    // expiry gate is still shut, and a settlement that claimed `Expired` here
    // would be announcing a transition that the registry then refuses. The two
    // sides have to agree, so the engine reports the truth: nothing is due yet.
    assert_eq!(
        w.engine_client().evaluate(&policy_id).status,
        SettlementStatus::Pending
    );
    assert_eq!(w.settle(policy_id).status, SettlementStatus::Pending);
    assert!(w.registry_client().is_active(&policy_id));
    assert_eq!(w.pool_client().reserves(), super::CAPITAL);

    // One second later the same call retires the policy, and its capital with it.
    w.at(WINDOW_CLOSE + 1);
    assert_eq!(w.settle(policy_id).status, SettlementStatus::Expired);
    assert_eq!(
        w.registry_client().get_policy(&policy_id).status,
        RegistryStatus::Expired
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #13)")]
fn expiring_at_the_closing_instant_is_still_too_early() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(900, WINDOW_OPEN + DAY);
    w.at(WINDOW_CLOSE);

    // Deferring to the registry rather than forwarding a call that would be
    // rejected keeps the engine's error a typed "not yet" for the keeper.
    w.engine_client().expire_policy(&policy_id);
}

// ---------------------------------------------------------------------------
// The read-only preview
// ---------------------------------------------------------------------------

#[test]
fn evaluate_previews_a_payout_without_moving_money() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(120, WINDOW_OPEN + 5 * DAY);

    let preview = w.engine_client().evaluate(&policy_id);

    assert_eq!(preview.status, SettlementStatus::Paid);
    assert_eq!(preview.payout_amount, PAYOUT);
    assert_eq!(preview.index_value, 120);
    // The keeper has only looked: no tokens moved and the policy is untouched.
    assert_eq!(w.token_client().balance(&w.farmer), 0);
    assert!(w.registry_client().is_active(&policy_id));
    assert_eq!(w.pool_client().reserves(), super::CAPITAL);
}

#[test]
fn evaluate_agrees_with_the_settlement_it_previews() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(120, WINDOW_OPEN + 5 * DAY);

    let preview = w.engine_client().evaluate(&policy_id);
    assert_eq!(preview.status, SettlementStatus::Paid);
    let outcome = w.settle(policy_id);

    // Same rule, same answer: a preview that could disagree with settlement
    // would make a keeper either miss claims or burn fees on no-ops.
    assert_eq!(preview.status, outcome.status);
    assert_eq!(preview.payout_amount, outcome.paid_amount);
}

// ---------------------------------------------------------------------------
// Liability bookkeeping
// ---------------------------------------------------------------------------

#[test]
fn an_expired_policys_capital_becomes_withdrawable_again() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);
    w.publish(900, WINDOW_OPEN + 5 * DAY);
    w.at(WINDOW_CLOSE + DAY);

    // While the cover is live the capital is reserved: 4,000 of liability at
    // the pool's 120% floor locks 4,800.
    assert_eq!(
        w.pool_client().max_withdrawable(),
        super::CAPITAL - (PAYOUT * 12_000 / 10_000)
    );

    w.settle(policy_id);

    let treasury = Address::generate(&w.env);
    w.pool_client()
        .withdraw_reserve(&w.admin, &treasury, &super::CAPITAL);
    assert_eq!(w.token_client().balance(&treasury), super::CAPITAL);
}

#[test]
fn cancelling_a_policy_lets_the_engine_drop_its_liability() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);

    // The farmer withdraws before cover opens; the registry refunds the premium
    // and the pool must stop reserving capital for a policy that is gone.
    w.registry_client().cancel_policy(&policy_id);
    w.engine_client().release_liability(&policy_id);

    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(w.token_client().balance(&w.farmer), PREMIUM);
    assert_eq!(w.pool_client().max_withdrawable(), super::CAPITAL);
}

#[test]
fn releasing_liability_for_a_policy_whose_cover_was_never_registered_is_a_no_op() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.registry_client().cancel_policy(&policy_id);

    w.engine_client().release_liability(&policy_id);

    assert_eq!(w.pool_client().outstanding_liability(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn liability_can_only_be_registered_once() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);

    // A double-counted liability would lock capital no policy is claiming.
    w.engine_client().register_liability(&policy_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #14)")]
fn liability_is_not_released_while_the_policy_is_still_live() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.engine_client().register_liability(&policy_id);

    // Dropping the cover early would free the capital its claim still needs.
    w.engine_client().release_liability(&policy_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn liability_is_not_registered_for_an_unknown_policy() {
    let w = setup();

    w.engine_client().register_liability(&7);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn liability_is_not_registered_for_a_policy_that_has_already_left_the_book() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.registry_client().cancel_policy(&policy_id);

    w.engine_client().register_liability(&policy_id);
}

// ---------------------------------------------------------------------------
// Failure modes that must not half-settle a policy
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Error(Contract, #9)")]
fn a_payout_the_pool_cannot_cover_does_not_settle_the_policy() {
    let w = setup();
    // A 4x payout on a 50k premium promises 200k against the 100k the pool
    // actually holds, so the claim is larger than the capital behind it.
    let policy_id = w.create_policy(0, THRESHOLD, 200_000, 50_000, WINDOW_OPEN, WINDOW_CLOSE);

    w.publish(120, WINDOW_OPEN + 5 * DAY);
    w.settle(policy_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn settling_an_unknown_policy_fails() {
    let w = setup();

    w.settle(404);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")]
fn settling_an_already_settled_policy_fails() {
    let w = setup();
    let policy_id = w.create_default_policy();
    w.publish(120, WINDOW_OPEN + 5 * DAY);
    w.settle(policy_id);

    w.settle(policy_id);
}

// ---------------------------------------------------------------------------
// Adjoining policies on one plot
// ---------------------------------------------------------------------------

/// The instant where two back-to-back windows meet belongs to the later one.
///
/// The registry rejects only *overlapping* windows, so a renewal starting
/// exactly where the current cover ends is a legal second policy on the same
/// plot — back-to-back cover the farmer can buy a season at a time. If both
/// windows counted a reading taken at the instant they meet, one drought would
/// pay twice: two premiums bought, one dry day observed, two payouts made.
#[test]
fn an_adjoining_renewal_alone_claims_the_instant_the_two_windows_meet() {
    let w = setup();

    // Cover on plot 0 runs up to `WINDOW_CLOSE`; the renewal starts there. Both
    // are accepted, which is the registry's half of this rule.
    let first = w.create_policy(0, THRESHOLD, PAYOUT, PREMIUM, WINDOW_OPEN, WINDOW_CLOSE);
    let renewal = w.create_policy(
        0,
        THRESHOLD,
        PAYOUT,
        PREMIUM,
        WINDOW_CLOSE,
        WINDOW_CLOSE + 30 * DAY,
    );
    assert_eq!((first, renewal), (1, 2));

    // One finalized drought reading, timestamped exactly on the shared instant.
    w.publish(120, WINDOW_CLOSE);

    // The keeper's next sweep. The earlier policy closes without a qualifying
    // reading, because the shared instant already sits outside its window.
    w.at(WINDOW_CLOSE + DAY);
    let earlier = w.settle(first);
    assert_eq!(earlier.status, SettlementStatus::Expired);
    assert_eq!(earlier.paid_amount, 0);

    // The renewal opened at the shared instant, so that same reading pays it.
    let later = w.settle(renewal);
    assert_eq!(later.status, SettlementStatus::Paid);
    assert_eq!(later.reading_timestamp, WINDOW_CLOSE);
    assert_eq!(later.paid_amount, PAYOUT);

    // One observation, one payout: the pool paid this drought once, not twice.
    assert_eq!(w.token_client().balance(&w.farmer), PAYOUT);
    assert_eq!(w.pool_client().reserves(), super::CAPITAL - PAYOUT);
    assert_eq!(w.pool_client().outstanding_liability(), 0);
    assert_eq!(
        w.registry_client().get_policy(&first).status,
        RegistryStatus::Expired
    );
    assert_eq!(
        w.registry_client().get_policy(&renewal).status,
        RegistryStatus::Settled
    );
}

/// The same boundary, settled in the other order.
///
/// Whichever policy a keeper reaches first, the reading on the shared instant is
/// the renewal's — settling the renewal does not make the closed policy claim
/// the same observation, and expiring the closed policy does not disturb a claim
/// the renewal has already been paid for.
#[test]
fn the_renewal_is_paid_even_when_it_is_settled_before_the_closed_policy() {
    let w = setup();
    let first = w.create_policy(0, THRESHOLD, PAYOUT, PREMIUM, WINDOW_OPEN, WINDOW_CLOSE);
    let renewal = w.create_policy(
        0,
        THRESHOLD,
        PAYOUT,
        PREMIUM,
        WINDOW_CLOSE,
        WINDOW_CLOSE + 30 * DAY,
    );

    w.publish(120, WINDOW_CLOSE);
    assert_eq!(w.settle(renewal).status, SettlementStatus::Paid);

    w.at(WINDOW_CLOSE + DAY);
    assert_eq!(w.settle(first).status, SettlementStatus::Expired);

    assert_eq!(w.token_client().balance(&w.farmer), PAYOUT);
    assert_eq!(w.pool_client().reserves(), super::CAPITAL - PAYOUT);
}
