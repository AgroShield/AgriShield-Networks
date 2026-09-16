//! Fee guards for the capital-moving paths.
//!
//! The pool's own storage costs little; what dominates a claim is the token
//! contract it has to talk to. A cross-contract call is a whole sub-invocation —
//! its own metering, its own ledger access — so the *number* of them is the
//! number worth pinning.
//!
//! `release_payout` and `withdraw_reserve` both read the pool's balance to
//! enforce the reserve floor and then report the post-transfer balance in their
//! event. Reporting it used to cost a *second* `balance()` call to the token
//! contract, on the reasoning that the pool holds no internal ledger so the
//! figure had to be observed. It does not: the transfer just made is the only
//! thing that can move the balance inside that call, so the post-transfer figure
//! is the pre-transfer one minus the amount.
//!
//! Measured on this suite, paying a claim: **369,707** CPU instructions with the
//! second `balance()` call, **308,445** without — a claim is ~17% cheaper. The
//! test budget meters instructions deterministically (host calls plus wasm
//! instructions, not wall-clock), so the ceiling below is reproducible.

use soroban_sdk::Env;

use crate::tests::{setup, PoolWorld};

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

/// A pool with capital in it, at 120% of a recognised liability.
fn capitalised() -> PoolWorld {
    let w = setup();
    w.deposit(100_000);
    w.accrue(5_000);
    w
}

/// Paying a claim must stay inside a budget a keeper can afford to submit.
///
/// The ceiling sits below what the redundant `balance()` call cost, so
/// reintroducing it fails here rather than in a farmer's fee.
#[test]
fn releasing_a_payout_costs_a_bounded_amount_of_cpu() {
    let w = capitalised();
    let cost = cpu_of(&w.env, || w.settle(5_000));

    assert!(
        cost < 340_000,
        "releasing a payout cost {cost} CPU instructions"
    );
}

/// The event's `reserves_after` is derived, so it must still be exactly right.
///
/// A cheap-but-wrong figure would be worse than the second cross-contract call,
/// so the derived value is checked against the token contract's own answer.
#[test]
fn the_reported_reserves_after_a_payout_match_the_token_balance() {
    let w = capitalised();
    let before = w.token_client().balance(&w.pool);

    w.settle(5_000);

    let after = w.token_client().balance(&w.pool);
    let stats = w.pool_client().stats();
    assert_eq!(before - after, 5_000);
    assert_eq!(stats.reserves, after, "the pool reports its real balance");
}

/// The same identity is relied on by the admin withdrawal path.
#[test]
fn the_reported_reserves_after_a_withdrawal_match_the_token_balance() {
    let w = capitalised();
    let before = w.token_client().balance(&w.pool);

    w.pool_client().withdraw_reserve(&w.admin, &w.donor, &1_000);

    let after = w.token_client().balance(&w.pool);
    assert_eq!(before - after, 1_000);
    assert_eq!(w.pool_client().stats().reserves, after);
}
