//! Unit tests for the premium pool.
//!
//! * [`deposits`] — capital in, accounting counters
//! * [`solvency`] — the ratio arithmetic and the health views
//! * [`withdrawals`] — the solvency floor on admin withdrawals
//! * [`payouts`] — engine-driven claims and liability bookkeeping
//! * [`authorization`] — who may move capital, and the engine allowlist
//! * [`fees`] — cost guards on the capital-moving paths
//!
//! The pool's payouts are only callable by the payout engine *contract*, so
//! these tests deploy [`MockEngine`] and drive the pool through it rather than
//! faking the caller. That exercises the same cross-contract path used in
//! production.

mod authorization;
mod deposits;
mod fees;
mod payouts;
mod solvency;
mod withdrawals;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env,
};

use crate::types::PoolStats;
use crate::{PremiumPool, PremiumPoolClient, DEFAULT_MIN_SOLVENCY_RATIO_BPS};

/// Fixed ledger clock for the harness.
pub const T0: u64 = 1_700_000_000;

/// A stand-in for the payout engine contract.
///
/// It forwards calls with `env.current_contract_address()` as the caller, so the
/// pool's `require_payout_engine` check is satisfied exactly the way the real
/// engine satisfies it — by being the invoking contract.
#[contract]
pub struct MockEngine;

#[contractimpl]
impl MockEngine {
    pub fn accrue(env: Env, pool: Address, amount: i128) {
        let me = env.current_contract_address();
        PremiumPoolClient::new(&env, &pool).accrue_liability(&me, &amount);
    }

    pub fn release(env: Env, pool: Address, amount: i128) {
        let me = env.current_contract_address();
        PremiumPoolClient::new(&env, &pool).release_liability(&me, &amount);
    }

    pub fn settle(env: Env, pool: Address, to: Address, amount: i128) {
        let me = env.current_contract_address();
        PremiumPoolClient::new(&env, &pool).release_payout(&me, &to, &amount);
    }

    pub fn stats(env: Env, pool: Address) -> PoolStats {
        PremiumPoolClient::new(&env, &pool).stats()
    }
}

/// A live pool wired to [`MockEngine`], plus a funded donor.
pub struct PoolWorld {
    pub env: Env,
    pub pool: Address,
    pub token: Address,
    pub admin: Address,
    pub farmer: Address,
    pub donor: Address,
    pub engine: Address,
}

/// Deploys the pool against a fresh asset contract, wires the mock engine and
/// funds the donor with 1,000,000 capital units.
pub fn setup() -> PoolWorld {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = T0);

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let donor = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let pool = env.register(PremiumPool, ());
    let engine = env.register(MockEngine, ());

    let world = PoolWorld {
        env,
        pool,
        token,
        admin,
        farmer,
        donor,
        engine,
    };

    world
        .pool_client()
        .initialize(&world.admin, &world.token, &DEFAULT_MIN_SOLVENCY_RATIO_BPS);
    world
        .pool_client()
        .set_payout_engine(&world.admin, &world.engine);
    world.mint(&world.donor.clone(), 1_000_000);

    world
}

impl PoolWorld {
    pub fn pool_client(&self) -> PremiumPoolClient<'_> {
        PremiumPoolClient::new(&self.env, &self.pool)
    }

    pub fn engine_client(&self) -> MockEngineClient<'_> {
        MockEngineClient::new(&self.env, &self.engine)
    }

    pub fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    /// Mints capital to `to` using the asset issuer's authority.
    pub fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    /// The donor capitalises the pool.
    pub fn deposit(&self, amount: i128) {
        self.pool_client().deposit(&self.donor, &amount);
    }

    /// The engine recognises `amount` of new liability.
    pub fn accrue(&self, amount: i128) {
        self.engine_client().accrue(&self.pool, &amount);
    }

    /// The engine pays a claim to the farmer.
    pub fn settle(&self, amount: i128) {
        self.engine_client()
            .settle(&self.pool, &self.farmer, &amount);
    }
}
