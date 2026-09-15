//! Storage layer for the oracle adapter.
//!
//! * instance — `Admin`, `Threshold`, and the signer set (small and hot; every
//!   submission reads it).
//! * persistent — per-region state: latest finalized reading, bounded history
//!   ring and in-flight pending readings.

use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

use crate::error::Error;
use crate::types::{IndexReading, PendingReading};

pub const PERSISTENT_TTL_THRESHOLD: u32 = 518_400; // ~30 days
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_220_800; // ~360 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Threshold,
    Signers,
    Latest(Symbol),
    History(Symbol),
    Pending(Symbol, u64),
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
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

pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn set_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&DataKey::Threshold, &threshold);
}

pub fn get_threshold(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Threshold)
        .ok_or(Error::NotInitialized)
}

// ---------------------------------------------------------------------------
// Signer set
// ---------------------------------------------------------------------------

pub fn get_signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get::<DataKey, Vec<Address>>(&DataKey::Signers)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_signers(env: &Env, signers: &Vec<Address>) {
    env.storage().instance().set(&DataKey::Signers, signers);
}

pub fn is_signer(env: &Env, signer: &Address) -> bool {
    get_signers(env).iter().any(|s| s == *signer)
}

/// Fails with [`Error::NotASigner`] unless `signer` is registered.
pub fn require_signer(env: &Env, signer: &Address) -> Result<(), Error> {
    if is_signer(env, signer) {
        Ok(())
    } else {
        Err(Error::NotASigner)
    }
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

pub fn get_latest(env: &Env, region_id: &Symbol) -> Result<IndexReading, Error> {
    let key = DataKey::Latest(region_id.clone());
    let reading: Option<IndexReading> = env.storage().persistent().get(&key);
    match reading {
        Some(r) => {
            bump(env, &key);
            Ok(r)
        }
        None => Err(Error::NoReading),
    }
}

pub fn has_latest(env: &Env, region_id: &Symbol) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Latest(region_id.clone()))
}

pub fn set_latest(env: &Env, reading: &IndexReading) {
    let key = DataKey::Latest(reading.region_id.clone());
    env.storage().persistent().set(&key, reading);
    bump(env, &key);
}

pub fn get_history(env: &Env, region_id: &Symbol) -> Vec<IndexReading> {
    let key = DataKey::History(region_id.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<IndexReading>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

/// Appends a finalized reading to the per-region ring, dropping the oldest entry
/// when the cap is reached so storage cost stays bounded per region.
pub fn push_history(env: &Env, reading: &IndexReading, cap: u32) {
    let key = DataKey::History(reading.region_id.clone());
    let mut history = get_history(env, &reading.region_id);
    history.push_back(reading.clone());
    while history.len() > cap {
        history.remove(0);
    }
    env.storage().persistent().set(&key, &history);
    bump(env, &key);
}

pub fn get_pending(env: &Env, region_id: &Symbol, timestamp: u64) -> Option<PendingReading> {
    let key = DataKey::Pending(region_id.clone(), timestamp);
    let pending: Option<PendingReading> = env.storage().persistent().get(&key);
    if pending.is_some() {
        bump(env, &key);
    }
    pending
}

pub fn set_pending(env: &Env, pending: &PendingReading) {
    let key = DataKey::Pending(pending.region_id.clone(), pending.timestamp);
    env.storage().persistent().set(&key, pending);
    bump(env, &key);
}

pub fn remove_pending(env: &Env, region_id: &Symbol, timestamp: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Pending(region_id.clone(), timestamp));
}

/// True when a reading for this (region, timestamp) is already finalized, i.e.
/// it is present in history or is the current latest reading.
pub fn is_finalized(env: &Env, region_id: &Symbol, timestamp: u64) -> bool {
    if let Ok(latest) = get_latest(env, region_id) {
        if latest.timestamp == timestamp {
            return true;
        }
    }
    get_history(env, region_id)
        .iter()
        .any(|r| r.timestamp == timestamp)
}
