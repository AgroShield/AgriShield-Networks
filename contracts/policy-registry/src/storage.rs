//! Persistent and instance storage access for the policy registry.
//!
//! Layout:
//! * instance — small, hot config that must always be readable with the
//!   contract: `Admin`, `PremiumToken`, `PayoutEngine`, `PolicyCount`.
//! * persistent — unbounded collections: the policies themselves plus the
//!   `plot_hash` / farmer / region lookup indexes the indexer and frontend use.

use soroban_sdk::{contracttype, Address, BytesN, Env, Symbol, Vec};

use crate::error::Error;
use crate::types::Policy;

/// TTL (in ledgers) applied to persistent entries.
///
/// `PERSISTENT_TTL_EXTEND_TO` must comfortably exceed the longest legal
/// coverage window (see `MAX_COVERAGE_WINDOW`, 180 days): at ~5s per ledger
/// 6,220,800 ledgers is ~360 days, so a policy can never silently expire from
/// ledger state while it is still settleable.
pub const PERSISTENT_TTL_THRESHOLD: u32 = 518_400; // ~30 days
pub const PERSISTENT_TTL_EXTEND_TO: u32 = 6_220_800; // ~360 days

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PremiumToken,
    PayoutEngine,
    PolicyCount,
    Policy(u64),
    PlotPolicies(BytesN<32>),
    FarmerPolicies(Address),
    RegionPolicies(Symbol),
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

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

/// Fails with [`Error::NotInitialized`] / [`Error::Unauthorized`] unless
/// `caller` is the stored admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin = get_admin(env).ok_or(Error::NotInitialized)?;
    if admin != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn set_premium_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::PremiumToken, token);
}

pub fn get_premium_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::PremiumToken)
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
    let engine = get_payout_engine(env)?;
    if engine != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

/// Reserves the next policy id and persists the incremented counter.
pub fn next_policy_id(env: &Env) -> Result<u64, Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    let current: u64 = env
        .storage()
        .instance()
        .get(&DataKey::PolicyCount)
        .unwrap_or(0);
    let next = current + 1;
    env.storage().instance().set(&DataKey::PolicyCount, &next);
    Ok(next)
}

pub fn policy_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::PolicyCount)
        .unwrap_or(0)
}

pub fn save_policy(env: &Env, policy: &Policy) {
    let key = DataKey::Policy(policy.id);
    env.storage().persistent().set(&key, policy);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
}

pub fn get_policy(env: &Env, policy_id: u64) -> Result<Policy, Error> {
    let key = DataKey::Policy(policy_id);
    let policy: Option<Policy> = env.storage().persistent().get(&key);
    match policy {
        Some(p) => {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_TTL_THRESHOLD,
                PERSISTENT_TTL_EXTEND_TO,
            );
            Ok(p)
        }
        None => Err(Error::PolicyNotFound),
    }
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/// Appends `id` to a `Vec<u64>` index, optionally enforcing a per-key cap.
///
/// The cap exists so a malicious actor cannot grow a plot index until iterating
/// it (the duplicate-overlap check) becomes unaffordable.
fn append_index(
    env: &Env,
    key: DataKey,
    id: u64,
    cap: Option<u32>,
    limit_err: Error,
) -> Result<(), Error> {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env));
    if let Some(max) = cap {
        if ids.len() >= max {
            return Err(limit_err);
        }
    }
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND_TO);
    Ok(())
}

pub fn add_plot_policy(env: &Env, plot_hash: &BytesN<32>, id: u64, cap: u32) -> Result<(), Error> {
    append_index(
        env,
        DataKey::PlotPolicies(plot_hash.clone()),
        id,
        Some(cap),
        Error::PlotPolicyLimitReached,
    )
}

pub fn add_farmer_policy(env: &Env, farmer: &Address, id: u64) -> Result<(), Error> {
    append_index(
        env,
        DataKey::FarmerPolicies(farmer.clone()),
        id,
        None,
        Error::PolicyNotFound,
    )
}

pub fn add_region_policy(env: &Env, region_id: &Symbol, id: u64) -> Result<(), Error> {
    append_index(
        env,
        DataKey::RegionPolicies(region_id.clone()),
        id,
        None,
        Error::PolicyNotFound,
    )
}

pub fn plot_policy_ids(env: &Env, plot_hash: &BytesN<32>) -> Vec<u64> {
    let key = DataKey::PlotPolicies(plot_hash.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn farmer_policy_ids(env: &Env, farmer: &Address) -> Vec<u64> {
    let key = DataKey::FarmerPolicies(farmer.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn region_policy_ids(env: &Env, region_id: &Symbol) -> Vec<u64> {
    let key = DataKey::RegionPolicies(region_id.clone());
    env.storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or_else(|| Vec::new(env))
}
