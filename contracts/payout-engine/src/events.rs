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

pub const TOPIC_ENGINE: &str = "engine";

pub fn contracts_configured(env: &Env, event: &ContractsConfigured) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ENGINE), Symbol::new(env, "config")),
        event.clone(),
    );
}
