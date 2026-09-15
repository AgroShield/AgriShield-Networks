//! Premium pool events, consumed by the backend's solvency dashboard and the
//! notification service (a payout is farmer-facing news).

use soroban_sdk::{contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Deposited {
    pub from: Address,
    pub amount: i128,
    pub reserves_after: i128,
    pub outstanding_liability: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutReleased {
    pub to: Address,
    pub amount: i128,
    pub reserves_after: i128,
    pub remaining_liability: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveWithdrawn {
    pub to: Address,
    pub amount: i128,
    pub reserves_after: i128,
    pub solvency_ratio_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiabilityChanged {
    pub previous: i128,
    pub current: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SolvencyRatioChanged {
    pub previous_bps: i128,
    pub current_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutEngineChanged {
    pub payout_engine: Address,
}

pub const TOPIC_POOL: &str = "pool";

pub fn deposited(env: &Env, event: &Deposited) {
    env.events().publish(
        (Symbol::new(env, TOPIC_POOL), Symbol::new(env, "deposit")),
        event.clone(),
    );
}

pub fn payout_released(env: &Env, event: &PayoutReleased) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_POOL),
            Symbol::new(env, "payout"),
            event.to.clone(),
        ),
        event.clone(),
    );
}

pub fn reserve_withdrawn(env: &Env, event: &ReserveWithdrawn) {
    env.events().publish(
        (Symbol::new(env, TOPIC_POOL), Symbol::new(env, "withdraw")),
        event.clone(),
    );
}

pub fn liability_changed(env: &Env, event: &LiabilityChanged) {
    env.events().publish(
        (Symbol::new(env, TOPIC_POOL), Symbol::new(env, "liab")),
        event.clone(),
    );
}

pub fn solvency_ratio_changed(env: &Env, event: &SolvencyRatioChanged) {
    env.events().publish(
        (Symbol::new(env, TOPIC_POOL), Symbol::new(env, "ratio")),
        event.clone(),
    );
}

pub fn payout_engine_changed(env: &Env, event: &PayoutEngineChanged) {
    env.events().publish(
        (Symbol::new(env, TOPIC_POOL), Symbol::new(env, "engine")),
        event.clone(),
    );
}
