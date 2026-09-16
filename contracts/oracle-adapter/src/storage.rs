//! Storage layer for the oracle adapter.
//!
//! * instance — `Admin`, `Threshold`, and the signer set (small and hot; every
//!   submission reads it).
//! * persistent — per-region state: the latest finalized reading, the bounded
//!   history (one entry per retained instant, plus a small index of their
//!   timestamps) and in-flight pending readings.

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
    /// Ordered timestamps of the readings retained for a region. One small entry
    /// (`u64` per retained reading) instead of the readings themselves.
    HistoryIndex(Symbol),
    /// A single finalized reading, keyed by region *and* the instant it observed.
    ///
    /// Per-instant entries rather than one `Vec` per region: the payout engine and
    /// the submission guard both need to answer "is there a reading for exactly
    /// this timestamp?", and with a `Vec` that meant reading (and, on write,
    /// rewriting) every retained reading — up to `MAX_HISTORY_PER_REGION` of them
    /// — on a path that runs for every signer of every reading.
    HistoryAt(Symbol, u64),
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

/// The retained timestamps for a region, oldest first.
fn get_history_index(env: &Env, region_id: &Symbol) -> Vec<u64> {
    let key = DataKey::HistoryIndex(region_id.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

/// Assembles the region's history, oldest first, for the `get_index_history`
/// view.
///
/// This is the *only* place that pays for the whole ring, and it is a read-only
/// view: a caller simulating it is charged nothing, so the trade that matters —
/// keeping the transaction paths off the ring — is the one made here.
pub fn get_history(env: &Env, region_id: &Symbol) -> Vec<IndexReading> {
    let mut history = Vec::new(env);
    for timestamp in get_history_index(env, region_id).iter() {
        let key = DataKey::HistoryAt(region_id.clone(), timestamp);
        if let Some(reading) = env
            .storage()
            .persistent()
            .get::<DataKey, IndexReading>(&key)
        {
            history.push_back(reading);
        }
    }
    history
}

/// The readings finalized inside `[start, end)`, oldest first.
///
/// The index is ascending, so entries before the window are skipped and the loop
/// stops at the first one past it. Neither is read: a caller asking for a
/// coverage window wants the handful of readings that window can contain, not
/// the season the region has accumulated. This is what the settlement path uses,
/// and it is why settling no longer moves a full history across a contract
/// boundary.
pub fn get_readings_in_range(
    env: &Env,
    region_id: &Symbol,
    start: u64,
    end: u64,
) -> Vec<IndexReading> {
    let mut readings = Vec::new(env);
    for timestamp in get_history_index(env, region_id).iter() {
        if timestamp < start {
            continue;
        }
        if timestamp >= end {
            break;
        }
        let key = DataKey::HistoryAt(region_id.clone(), timestamp);
        if let Some(reading) = env
            .storage()
            .persistent()
            .get::<DataKey, IndexReading>(&key)
        {
            readings.push_back(reading);
        }
    }
    readings
}

/// Whether a finalized reading is retained for exactly `(region, timestamp)`.
///
/// One existence check on one entry — no value is read, so no bytes are charged.
pub fn has_history(env: &Env, region_id: &Symbol, timestamp: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::HistoryAt(region_id.clone(), timestamp))
}

/// Retains a finalized reading, dropping the oldest one when the cap is reached
/// so storage cost stays bounded per region.
///
/// Writes one reading and one timestamp instead of rewriting the whole ring.
/// Pruning removes the evicted reading's entry as well, so a region that has been
/// publishing since genesis holds no more entries than the cap allows.
pub fn push_history(env: &Env, reading: &IndexReading, cap: u32) {
    let at_key = DataKey::HistoryAt(reading.region_id.clone(), reading.timestamp);
    env.storage().persistent().set(&at_key, reading);
    bump(env, &at_key);

    let index_key = DataKey::HistoryIndex(reading.region_id.clone());
    let mut index = get_history_index(env, &reading.region_id);
    index.push_back(reading.timestamp);
    // Readings are strictly monotonic in `timestamp`, so the index is already
    // sorted and the oldest entry is always the one at the front.
    while index.len() > cap {
        if let Some(evicted) = index.get(0) {
            env.storage()
                .persistent()
                .remove(&DataKey::HistoryAt(reading.region_id.clone(), evicted));
        }
        index.remove(0);
    }
    env.storage().persistent().set(&index_key, &index);
    bump(env, &index_key);
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
    has_history(env, region_id, timestamp)
}
