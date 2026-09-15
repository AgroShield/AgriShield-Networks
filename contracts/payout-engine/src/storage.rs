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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PolicyRegistry,
    PremiumPool,
    Oracle,
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
