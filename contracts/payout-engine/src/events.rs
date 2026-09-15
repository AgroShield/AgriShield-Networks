//! Payout engine events, consumed by the backend's settlement worker and the
//! notification service (a settlement is farmer-facing news).

use soroban_sdk::{contracttype, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractsConfigured {
    pub policy_registry: Address,
    pub premium_pool: Address,
    pub oracle: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyLiabilityRegistered {
    pub policy_id: u64,
    pub payout_amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyLiabilityReleased {
    pub policy_id: u64,
    pub payout_amount: i128,
}

pub const TOPIC_ENGINE: &str = "engine";

pub fn contracts_configured(env: &Env, event: &ContractsConfigured) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ENGINE), Symbol::new(env, "config")),
        event.clone(),
    );
}

pub fn liability_registered(env: &Env, event: &PolicyLiabilityRegistered) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ENGINE), Symbol::new(env, "liab_in")),
        event.clone(),
    );
}

pub fn liability_released(env: &Env, event: &PolicyLiabilityReleased) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ENGINE), Symbol::new(env, "liab_out")),
        event.clone(),
    );
}
