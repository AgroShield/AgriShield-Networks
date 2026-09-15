//! Storage layout for the premium pool.
//!
//! Everything lives in instance storage: the pool has a fixed, small set of
//! scalars (config + accounting counters) and no per-account entries, because
//! balances are held as real token balances rather than internal ledgers. That
//! keeps `reserves` always identical to the on-chain token balance, so no book
//! can drift out of sync with reality.

use soroban_sdk::{contracttype, Address, Env};

use crate::error::Error;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    PayoutEngine,
    MinSolvencyRatioBps,
    OutstandingLiability,
    TotalDeposited,
    TotalReleased,
    TotalWithdrawn,
}

fn get_i128(env: &Env, key: DataKey) -> i128 {
    env.storage().instance().get(&key).unwrap_or(0)
}

fn set_i128(env: &Env, key: DataKey, value: i128) {
    env.storage().instance().set(&key, &value);
}

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

pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NotInitialized)
}

pub fn set_payout_engine(env: &Env, engine: &Address) {
    env.storage().instance().set(&DataKey::PayoutEngine, engine);
}

pub fn get_payout_engine(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::PayoutEngine)
        .ok_or(Error::NotInitialized)
}

/// Fails unless `caller` is the registered payout engine contract.
pub fn require_payout_engine(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_payout_engine(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn set_min_solvency_ratio(env: &Env, ratio_bps: i128) {
    set_i128(env, DataKey::MinSolvencyRatioBps, ratio_bps);
}

pub fn get_min_solvency_ratio(env: &Env) -> i128 {
    get_i128(env, DataKey::MinSolvencyRatioBps)
}

pub fn get_outstanding_liability(env: &Env) -> i128 {
    get_i128(env, DataKey::OutstandingLiability)
}

pub fn set_outstanding_liability(env: &Env, liability: i128) {
    set_i128(env, DataKey::OutstandingLiability, liability);
}

pub fn total_deposited(env: &Env) -> i128 {
    get_i128(env, DataKey::TotalDeposited)
}

pub fn add_deposited(env: &Env, amount: i128) {
    set_i128(env, DataKey::TotalDeposited, total_deposited(env) + amount);
}

pub fn total_released(env: &Env) -> i128 {
    get_i128(env, DataKey::TotalReleased)
}

pub fn add_released(env: &Env, amount: i128) {
    set_i128(env, DataKey::TotalReleased, total_released(env) + amount);
}

pub fn total_withdrawn(env: &Env) -> i128 {
    get_i128(env, DataKey::TotalWithdrawn)
}

pub fn add_withdrawn(env: &Env, amount: i128) {
    set_i128(env, DataKey::TotalWithdrawn, total_withdrawn(env) + amount);
}
