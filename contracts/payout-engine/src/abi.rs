//! Mirrors of the cross-contract types the engine decodes.
//!
//! Soroban contract types are not shared between crates: every contract that
//! wants to read another's `#[contracttype]` values must declare an identical
//! layout of its own. The definitions below therefore repeat the ones in
//! `policy-registry` and `oracle-adapter` **verbatim**. Field names, order and
//! types must stay in lockstep with those crates, because Soroban encodes the
//! structs as named maps — a rename here silently changes the ABI.
//!
//! They are deliberately not imported from the sibling crates: each contract is
//! deployed as its own wasm blob, and depending on a sibling's crate would link
//! that contract's entry points into this one.

use soroban_sdk::{contracttype, Address, BytesN, Symbol};

// ---------------------------------------------------------------------------
// policy-registry
// ---------------------------------------------------------------------------

/// Lifecycle of a policy, mirrored from `policy_registry::PolicyStatus`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyStatus {
    /// Premium escrowed, coverage window not yet resolved.
    Active = 0,
    /// Payout released by the payout engine.
    Settled = 1,
    /// Coverage window elapsed with no qualifying trigger (no payout due).
    Expired = 2,
    /// Cancelled by the farmer before coverage started; premium refunded.
    Cancelled = 3,
}

/// A policy as stored by the registry, mirrored from `policy_registry::Policy`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub id: u64,
    pub farmer: Address,
    pub plot_hash: BytesN<32>,
    pub crop_type: Symbol,
    pub region_id: Symbol,
    pub coverage_start: u64,
    pub coverage_end: u64,
    /// Index value at or below which the policy pays out.
    pub trigger_threshold: i128,
    pub payout_amount: i128,
    pub premium: i128,
    pub status: PolicyStatus,
    pub created_at: u64,
    /// Ledger timestamp the policy reached a terminal status; `0` while active.
    pub settled_at: u64,
}

impl Policy {
    /// True when the policy is still settleable.
    pub fn is_active(&self) -> bool {
        matches!(self.status, PolicyStatus::Active)
    }
}

// ---------------------------------------------------------------------------
// oracle-adapter
// ---------------------------------------------------------------------------

/// A reading that reached the signer threshold, mirrored from
/// `oracle_adapter::IndexReading`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexReading {
    pub region_id: Symbol,
    pub index_value: i128,
    pub timestamp: u64,
    pub finalized_at: u64,
    /// Number of signer approvals collected when it finalized.
    pub approvals: u32,
}
