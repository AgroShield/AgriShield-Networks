//! Unit tests for the oracle adapter.
//!
//! * [`signers`] — signer-set administration and threshold bounds
//! * [`submission`] — partial signatures, conflicts, staleness, sanity bands
//! * [`finalization`] — reaching the threshold, immutability, per-region isolation
//! * [`history`] — bounded ring of finalized readings
//! * [`fees`] — cost guards on the submission path
//! * [`threshold`] — the pure N-of-M helpers
//! * [`auth`] — signature requirements on admin and signer entry points

mod auth;
mod fees;
mod finalization;
mod history;
mod signers;
mod submission;
mod threshold;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, Symbol,
};

use crate::{OracleAdapter, OracleAdapterClient, SubmissionOutcome};

/// Deterministic ledger clock for the harness.
pub const T0: u64 = 1_700_000_000;
pub const DAY: u64 = 24 * 60 * 60;

/// A live adapter plus the actors a test cares about.
pub struct OracleWorld {
    pub env: Env,
    pub adapter: Address,
    pub admin: Address,
    pub signers: [Address; 3],
    pub outsider: Address,
    pub region_id: Symbol,
}

/// Deploys the adapter with `threshold` and registers `signer_count` signers
/// (1..=3) taken from the fixed signer array.
pub fn setup(threshold: u32, signer_count: usize) -> OracleWorld {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| li.timestamp = T0);

    let admin = Address::generate(&env);
    let outsider = Address::generate(&env);
    let adapter = env.register(OracleAdapter, ());
    let client = OracleAdapterClient::new(&env, &adapter);

    let signers = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    client.initialize(&admin, &threshold);
    for signer in signers.iter().take(signer_count) {
        client.add_signer(&admin, signer);
    }

    let region_id = Symbol::new(&env, "ng_kaduna");

    OracleWorld {
        env,
        adapter,
        admin,
        signers,
        outsider,
        region_id,
    }
}

impl OracleWorld {
    pub fn client(&self) -> OracleAdapterClient<'_> {
        OracleAdapterClient::new(&self.env, &self.adapter)
    }

    /// Moves the ledger clock to an absolute timestamp.
    pub fn at(&self, timestamp: u64) {
        self.env.ledger().with_mut(|li| li.timestamp = timestamp);
    }

    /// A second region, used for isolation tests.
    pub fn other_region(&self) -> Symbol {
        Symbol::new(&self.env, "ke_machakos")
    }

    /// Submits an approval as `signer` without touching the ledger clock.
    ///
    /// Use this when the test deliberately drives a clock-skew condition.
    pub fn submit(&self, signer: &Address, value: i128, timestamp: u64) -> SubmissionOutcome {
        self.client()
            .submit_index(signer, &self.region_id, &value, &timestamp)
    }

    /// Advances the ledger clock to `timestamp` (if needed) and submits.
    ///
    /// An observation is published at or after the moment it describes, so the
    /// happy-path tests move the chain clock forward before publishing.
    pub fn submit_at(&self, signer: &Address, value: i128, timestamp: u64) -> SubmissionOutcome {
        if self.env.ledger().timestamp() < timestamp {
            self.at(timestamp);
        }
        self.submit(signer, value, timestamp)
    }
}
