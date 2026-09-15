//! Oracle adapter events.
//!
//! `index_finalized` is the event the backend indexer uses to react to a
//! settlement opportunity (it then calls `PayoutEngine::settle_policy`).
//! `approval_recorded` is used for observability of the multi-sig handshake.

use soroban_sdk::{contracttype, Address, Env, Symbol};

use crate::types::IndexReading;

/// Emitted when a reading reaches the signer threshold.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexFinalized {
    pub region_id: Symbol,
    pub index_value: i128,
    pub timestamp: u64,
    pub approvals: u32,
}

/// Emitted for every accepted partial signature.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalRecorded {
    pub region_id: Symbol,
    pub timestamp: u64,
    pub signer: Address,
    pub approvals: u32,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerAdded {
    pub signer: Address,
    pub signer_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerRemoved {
    pub signer: Address,
    pub signer_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdChanged {
    pub threshold: u32,
    pub signer_count: u32,
}

pub const TOPIC_ORACLE: &str = "oracle";

pub fn index_finalized(env: &Env, reading: &IndexReading) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_ORACLE),
            Symbol::new(env, "finalized"),
            reading.region_id.clone(),
        ),
        IndexFinalized {
            region_id: reading.region_id.clone(),
            index_value: reading.index_value,
            timestamp: reading.timestamp,
            approvals: reading.approvals,
        },
    );
}

pub fn approval_recorded(env: &Env, event: &ApprovalRecorded) {
    env.events().publish(
        (
            Symbol::new(env, TOPIC_ORACLE),
            Symbol::new(env, "approval"),
            event.region_id.clone(),
        ),
        event.clone(),
    );
}

pub fn signer_added(env: &Env, event: &SignerAdded) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ORACLE), Symbol::new(env, "signer")),
        event.clone(),
    );
}

pub fn signer_removed(env: &Env, event: &SignerRemoved) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ORACLE), Symbol::new(env, "signer")),
        event.clone(),
    );
}

pub fn threshold_changed(env: &Env, event: &ThresholdChanged) {
    env.events().publish(
        (Symbol::new(env, TOPIC_ORACLE), Symbol::new(env, "thresh")),
        event.clone(),
    );
}
