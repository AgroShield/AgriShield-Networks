//! Contract events consumed by the backend policy indexer.
//!
//! Topic layout is stable API: `(contract_tag, action, policy_id)`. The indexer
//! filters on `contract_tag` and `action`, so appending new actions is safe and
//! changing existing ones is a breaking change.

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol};

/// Emitted when a policy is minted and its premium escrowed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyCreated {
    pub policy_id: u64,
    pub farmer: Address,
    pub plot_hash: BytesN<32>,
    pub crop_type: Symbol,
    pub region_id: Symbol,
    pub coverage_start: u64,
    pub coverage_end: u64,
    pub trigger_threshold: i128,
    pub payout_amount: i128,
    pub premium: i128,
}

/// Emitted when a policy's status becomes terminal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyStatusChanged {
    pub policy_id: u64,
    pub status: u32,
    pub payout_amount: i128,
    pub settled_at: u64,
}

/// Emitted when the admin wires the payout engine contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutEngineSet {
    pub payout_engine: Address,
}

pub const TOPIC_REGISTRY: &str = "registry";
pub const ACTION_CREATED: &str = "created";
pub const ACTION_STATUS: &str = "status";
pub const ACTION_ENGINE: &str = "engine";

pub fn policy_created(env: &Env, event: &PolicyCreated) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_REGISTRY),
            Symbol::new(env, ACTION_CREATED),
            event.policy_id,
        ),
        event.clone(),
    );
}

pub fn policy_status_changed(env: &Env, event: &PolicyStatusChanged) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_REGISTRY),
            Symbol::new(env, ACTION_STATUS),
            event.policy_id,
        ),
        event.clone(),
    );
}

pub fn payout_engine_set(env: &Env, event: &PayoutEngineSet) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_REGISTRY),
            Symbol::new(env, ACTION_ENGINE),
        ),
        event.clone(),
    );
}
