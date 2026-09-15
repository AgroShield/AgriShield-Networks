//! Storage layout for the payout engine.
//!
//! * instance — the small, hot config block: the admin plus the three contract
//!   addresses the engine orchestrates. Every call reads it, so it must always
//!   be available with the contract.
//! * persistent — one flag per policy recording whether the pool has already
//!   recognised that policy's payout as liability. Recognising liability twice
//!   would double-count risk, and releasing it without having recognised it
//!   would erase another policy's cover, so the "recognise then release" pair
//!   must be balanced per policy rather than in aggregate.

use soroban_sdk::{contracttype, Address, Env};

use crate::error::Error;

/// TTL (in ledgers) applied to persistent entries.
///
/// Mirrors the policy registry: the longest legal coverage window is 180 days,
/// so a liability flag must comfortably outlive its policy, otherwise a late
/// settlement would lose track of the capital it is holding.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 518_400; // ~30 days
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_220_800; // ~360 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PolicyRegistry,
    PremiumPool,
    Oracle,
    /// Set while the pool carries this policy's payout as recognised liability.
    LiabilityRegistered(u64),
}

// ---------------------------------------------------------------------------
// Instance config
// ---------------------------------------------------------------------------

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

/// Fails with [`Error::NotInitialized`] / [`Error::Unauthorized`] unless
/// `caller` is the stored admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn set_policy_registry(env: &Env, address: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::PolicyRegistry, address);
}

pub fn get_policy_registry(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::PolicyRegistry)
        .ok_or(Error::NotInitialized)
}

pub fn set_premium_pool(env: &Env, address: &Address) {
    env.storage().instance().set(&DataKey::PremiumPool, address);
}

pub fn get_premium_pool(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::PremiumPool)
        .ok_or(Error::NotInitialized)
}

pub fn set_oracle(env: &Env, address: &Address) {
    env.storage().instance().set(&DataKey::Oracle, address);
}

pub fn get_oracle(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Oracle)
        .ok_or(Error::NotInitialized)
}

// ---------------------------------------------------------------------------
// Per-policy liability tracking
// ---------------------------------------------------------------------------

pub fn liability_registered(env: &Env, policy_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::LiabilityRegistered(policy_id))
}

pub fn mark_liability_registered(env: &Env, policy_id: u64) {
    let key = DataKey::LiabilityRegistered(policy_id);
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn clear_liability_registered(env: &Env, policy_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::LiabilityRegistered(policy_id));
}
