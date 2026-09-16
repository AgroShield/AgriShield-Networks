//! Local interfaces for the three contracts the engine orchestrates.
//!
//! The engine calls its siblings by address, so it declares the slice of each
//! ABI it needs here and lets [`soroban_sdk::contractclient`] generate the
//! clients. Declaring them locally — rather than depending on the sibling
//! crates — keeps their entry points out of the engine's wasm blob.

use soroban_sdk::{contractclient, Address, Env, Symbol, Vec};

use crate::abi::{IndexReading, Policy};

/// The part of `policy-registry` the engine uses: reading terms and claiming a
/// terminal state.
#[contractclient(name = "PolicyRegistryClient")]
pub trait PolicyRegistryInterface {
    fn get_policy(env: Env, policy_id: u64) -> Result<Policy, crate::error::Error>;
    fn mark_settled(env: Env, caller: Address, policy_id: u64) -> Result<(), crate::error::Error>;
    fn expire_policy(env: Env, policy_id: u64) -> Result<(), crate::error::Error>;
    fn payout_engine(env: Env) -> Result<Address, crate::error::Error>;
}

/// The part of `premium-pool` the engine uses: recognising cover liability and
/// releasing a claim.
#[contractclient(name = "PremiumPoolClient")]
pub trait PremiumPoolInterface {
    fn accrue_liability(env: Env, caller: Address, amount: i128)
        -> Result<(), crate::error::Error>;
    fn release_liability(
        env: Env,
        caller: Address,
        amount: i128,
    ) -> Result<(), crate::error::Error>;
    fn release_payout(
        env: Env,
        caller: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), crate::error::Error>;
    fn payout_engine(env: Env) -> Result<Address, crate::error::Error>;
}

/// The part of `oracle-adapter` the engine uses: the region's finalized readings.
///
/// Only the windowed query is declared, not the full history. The engine can
/// never have a use for a reading outside a policy's coverage window, and
/// declaring the narrower call is what keeps a settlement from pulling a whole
/// season's readings across the boundary to throw most of them away.
#[contractclient(name = "OracleAdapterClient")]
pub trait OracleAdapterInterface {
    fn get_index_history_between(
        env: Env,
        region_id: Symbol,
        start: u64,
        end: u64,
    ) -> Vec<IndexReading>;
}
