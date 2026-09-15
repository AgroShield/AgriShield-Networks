//! Unit tests for the policy registry.
//!
//! Each module targets one invariant from the contract-level docs, so a failing
//! test points directly at the rule that broke:
//! * [`creation`] — parameter validation, id allocation, escrow on mint
//! * [`windows`] — coverage-window boundaries and retroactive cover
//! * [`duplicates`] — dynamic-weather-proofing: no overlapping cover per plot
//! * [`queries`] — read paths used by the indexer and frontend
//! * [`escrow`] — premium custody and cancellation refunds
//! * [`settlement`] — engine-only settlement, expiry, idempotency
//! * [`authorization`] — signature requirements on every privileged entry point

mod authorization;
mod creation;
mod duplicates;
mod escrow;
mod queries;
mod settlement;
mod windows;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, Symbol,
};

use crate::{PolicyRegistry, PolicyRegistryClient};

/// One day in seconds; coverage windows are expressed in days for readability.
pub const DAY: u64 = 24 * 60 * 60;

/// Fixed "now" for the harness so timestamps in assertions are deterministic.
pub const T0: u64 = 1_700_000_000;

/// Everything a test needs: a live registry, a premium token (Stellar Asset
/// Contract), and the three actors that participate in the flow.
pub struct TestWorld {
    pub env: Env,
    pub registry: Address,
    pub token: Address,
    pub admin: Address,
    pub farmer: Address,
    pub engine: Address,
}

/// Deploys the registry against a fresh asset contract, wires the payout engine
/// and funds the farmer with 100k premium-token units (7 decimals).
pub fn setup() -> TestWorld {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = T0);

    let admin = Address::generate(&env);
    let farmer = Address::generate(&env);
    let engine = Address::generate(&env);

    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let registry = env.register(PolicyRegistry, ());

    let world = TestWorld {
        env,
        registry,
        token,
        admin,
        farmer,
        engine,
    };

    world
        .registry_client()
        .initialize(&world.admin, &world.token);
    world
        .registry_client()
        .set_payout_engine(&world.admin, &world.engine);
    world.mint(&world.farmer.clone(), 100_000);

    world
}

impl TestWorld {
    pub fn registry_client(&self) -> PolicyRegistryClient<'_> {
        PolicyRegistryClient::new(&self.env, &self.registry)
    }

    pub fn token_client(&self) -> TokenClient<'_> {
        TokenClient::new(&self.env, &self.token)
    }

    /// Mints premium tokens to `to` using the asset issuer's authority.
    pub fn mint(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(to, &amount);
    }

    /// Moves the ledger clock to an absolute timestamp.
    pub fn at(&self, timestamp: u64) {
        self.env.ledger().with_mut(|li| li.timestamp = timestamp);
    }

    /// Deterministic plot identifier: 32 bytes derived from `seed`.
    pub fn plot(&self, seed: u8) -> BytesN<32> {
        BytesN::from_array(&self.env, &[seed; 32])
    }

    /// Creates `spec` as the harness farmer.
    pub fn create(&self, spec: &PolicySpec) -> u64 {
        self.registry_client().create_policy(
            &self.farmer,
            &spec.plot_hash,
            &spec.crop_type,
            &spec.region_id,
            &spec.coverage_start,
            &spec.coverage_end,
            &spec.trigger_threshold,
            &spec.payout_amount,
            &spec.premium,
        )
    }
}

/// Canonical "drought cover on a rain-fed maize plot" parameters.
///
/// Premium 5,000 with payout 2,000 sits inside the 50% pool-safety ratio, and
/// the payout covers the farmer's input costs for a single season.
#[derive(Clone)]
pub struct PolicySpec {
    pub plot_hash: BytesN<32>,
    pub crop_type: Symbol,
    pub region_id: Symbol,
    pub coverage_start: u64,
    pub coverage_end: u64,
    pub trigger_threshold: i128,
    pub payout_amount: i128,
    pub premium: i128,
}

impl PolicySpec {
    pub fn new(env: &Env) -> Self {
        Self {
            plot_hash: BytesN::from_array(env, &[1u8; 32]),
            crop_type: Symbol::new(env, "maize"),
            region_id: Symbol::new(env, "ng_kaduna"),
            coverage_start: T0 + DAY,
            coverage_end: T0 + 60 * DAY,
            trigger_threshold: 350,
            payout_amount: 2_000,
            premium: 5_000,
        }
    }

    /// Same terms on a different plot.
    pub fn on_plot(mut self, plot_hash: BytesN<32>) -> Self {
        self.plot_hash = plot_hash;
        self
    }

    /// Same terms on a different coverage window.
    pub fn covering(mut self, start: u64, end: u64) -> Self {
        self.coverage_start = start;
        self.coverage_end = end;
        self
    }
}
