//! Unit tests for the payout engine.
//!
//! The engine never touches funds itself — every settlement is a chain of
//! cross-contract calls into the registry, the oracle and the pool — so mocking
//! any of those three would test the mock rather than the engine. These tests
//! therefore deploy all four contracts and settle real policies over the same
//! call path production uses. A change to a sibling's authorisation or
//! accounting rules then shows up here as a failing settlement instead of
//! passing silently.
//!
//! * [`trigger`] — the pure decision table
//! * [`properties`] — the same rule, checked against a generated reference
//! * [`settlement`] — payouts, expiry and liability through the whole system
//! * [`authorization`] — who may configure the engine, and what it refuses to
//!   be configured against

mod authorization;
mod properties;
mod settlement;
mod trigger;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Symbol,
};

// The harness drives the siblings through *their* generated clients rather than
// the narrow interfaces the engine declares for itself, so a test can inspect
// state the engine has no reason to read (pool balances, policy status) and any
// drift between the two is caught.
use oracle_adapter::{OracleAdapter, OracleAdapterClient};
use policy_registry::{PolicyRegistry, PolicyRegistryClient};
use premium_pool::{PremiumPool, PremiumPoolClient, DEFAULT_MIN_SOLVENCY_RATIO_BPS};

use crate::{PayoutEngine, PayoutEngineClient, SettlementOutcome};

/// Deterministic ledger clock for the harness.
pub const T0: u64 = 1_700_000_000;
pub const DAY: u64 = 24 * 60 * 60;

/// Coverage window for the harness policy. It starts ten days after the clock
/// so a policy can be cancelled before cover opens, and runs the 30 days the
/// settlement tests need to place readings before, inside and after it.
pub const WINDOW_OPEN: u64 = T0 + 10 * DAY;
pub const WINDOW_CLOSE: u64 = WINDOW_OPEN + 30 * DAY;

/// Harness policy economics: a 4x payout on the premium, which clears the
/// registry's payout-to-premium cap with room to spare.
pub const PREMIUM: i128 = 1_000;
pub const PAYOUT: i128 = 4_000;

/// Rainfall at or below this triggers the harness policy.
pub const THRESHOLD: i128 = 300;

/// Capital the backer puts behind the pool.
pub const CAPITAL: i128 = 100_000;

/// A live stack: engine, registry, pool, oracle and a funded backer.
pub struct World {
    pub env: Env,
    pub engine: Address,
    pub registry: Address,
    pub pool: Address,
    pub oracle: Address,
    pub token: Address,
    pub admin: Address,
    pub farmer: Address,
    pub signer: Address,
    pub capital: Address,
    pub region: Symbol,
}

/// Deploys the four contracts, wires them together and funds the backer.
///
/// The deployment order is not incidental: the engine refuses to start unless
/// the registry and the pool already name it as their payout engine.
pub fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = T0);

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let signer = Address::generate(&env);
    let capital = Address::generate(&env);
    let region = Symbol::new(&env, "ng_kaduna");

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let registry = env.register(PolicyRegistry, ());
    let pool = env.register(PremiumPool, ());
    let oracle = env.register(OracleAdapter, ());
    let engine = env.register(PayoutEngine, ());

    PolicyRegistryClient::new(&env, &registry).initialize(&admin, &token);
    PolicyRegistryClient::new(&env, &registry).set_payout_engine(&admin, &engine);

    PremiumPoolClient::new(&env, &pool).initialize(&admin, &token, &DEFAULT_MIN_SOLVENCY_RATIO_BPS);
    PremiumPoolClient::new(&env, &pool).set_payout_engine(&admin, &engine);

    // A single signer is enough to finalize a reading; the oracle's own tests
    // cover the N-of-M handshake.
    OracleAdapterClient::new(&env, &oracle).initialize(&admin, &1);
    OracleAdapterClient::new(&env, &oracle).add_signer(&admin, &signer);

    PayoutEngineClient::new(&env, &engine).initialize(&admin, &registry, &pool, &oracle);

    let world = World {
        env,
        engine,
        registry,
        pool,
        oracle,
        token,
        admin,
        farmer,
        signer,
        capital,
        region,
    };
    world.fund_pool(CAPITAL);
    world
}

impl World {
    pub fn engine_client(&self) -> PayoutEngineClient<'_> {
        PayoutEngineClient::new(&self.env, &self.engine)
    }

    pub fn registry_client(&self) -> PolicyRegistryClient<'_> {
        PolicyRegistryClient::new(&self.env, &self.registry)
    }

    pub fn pool_client(&self) -> PremiumPoolClient<'_> {
        PremiumPoolClient::new(&self.env, &self.pool)
    }

    pub fn oracle_client(&self) -> OracleAdapterClient<'_> {
        OracleAdapterClient::new(&self.env, &self.oracle)
    }

    pub fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    /// Moves the ledger clock to an absolute timestamp.
    pub fn at(&self, timestamp: u64) {
        self.env.ledger().with_mut(|li| li.timestamp = timestamp);
    }

    /// Mints capital units to `to` using the asset issuer's authority.
    pub fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    /// Mints capital to the backer and moves it into the pool.
    pub fn fund_pool(&self, amount: i128) {
        self.mint(&self.capital, amount);
        self.pool_client().deposit(&self.capital, &amount);
    }

    /// Mints a policy for the harness farmer and returns its id.
    ///
    /// `plot_seed` picks the plot, so two policies in one test can share a
    /// window without tripping the registry's double-insurance guard.
    pub fn create_policy(
        &self,
        plot_seed: u8,
        trigger_threshold: i128,
        payout_amount: i128,
        premium: i128,
        start: u64,
        end: u64,
    ) -> u64 {
        self.mint(&self.farmer, premium);
        self.registry_client().create_policy(
            &self.farmer,
            &BytesN::from_array(&self.env, &[plot_seed; 32]),
            &Symbol::new(&self.env, "maize"),
            &self.region,
            &start,
            &end,
            &trigger_threshold,
            &payout_amount,
            &premium,
        )
    }

    /// The common case: the harness terms on plot 0.
    pub fn create_default_policy(&self) -> u64 {
        self.create_policy(0, THRESHOLD, PAYOUT, PREMIUM, WINDOW_OPEN, WINDOW_CLOSE)
    }

    /// Publishes a finalized reading for the harness region.
    ///
    /// An observation is published at or after the moment it describes, so the
    /// clock is advanced first; the oracle rejects timestamps it has not
    /// reached yet.
    pub fn publish(&self, index_value: i128, timestamp: u64) {
        if self.env.ledger().timestamp() < timestamp {
            self.at(timestamp);
        }
        self.oracle_client()
            .submit_index(&self.signer, &self.region, &index_value, &timestamp);
    }

    /// Runs one settlement round for `policy_id`.
    pub fn settle(&self, policy_id: u64) -> SettlementOutcome {
        self.engine_client().settle_policy(&policy_id)
    }
}
