//! Value types shared by the oracle adapter, the payout engine and the indexer.

use soroban_sdk::{contracttype, Address, Symbol, Vec};

/// Maximum number of readings retained per region. History is a ring so a
/// publisher cannot grow storage cost without bound; the API exposes it for the
/// frontend's "index history" chart.
pub const MAX_HISTORY_PER_REGION: u32 = 64;

/// Maximum number of authorised oracle signers. Bounds the approval scan and
/// keeps the threshold handshake cheap to verify on-chain.
pub const MAX_SIGNERS: u32 = 15;

/// Maximum index value accepted (e.g. 5,000 mm of rainfall for a season).
/// Guards the arithmetic downstream (pool solvency, payout curves).
pub const MAX_INDEX_VALUE: i128 = 5_000;

/// Readings may not be timestamped more than this far ahead of the ledger
/// clock. Observations describe the past, so anything newer is bogus or a
/// clock-skew attack.
pub const MAX_FUTURE_SKEW_SECONDS: u64 = 300;

/// A reading that has reached the signer threshold and is immutable.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IndexReading {
    pub region_id: Symbol,
    pub index_value: i128,
    pub timestamp: u64,
    pub finalized_at: u64,
    /// Number of signer approvals collected when it finalized.
    pub approvals: u32,
}

/// A reading that some (but not enough) signers have co-signed.
///
/// All approvals must agree on `index_value`: a signer that disagrees with an
/// in-flight reading produces [`crate::Error::ConflictingValue`] instead of
/// silently splitting the vote.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingReading {
    pub region_id: Symbol,
    pub index_value: i128,
    pub timestamp: u64,
    pub approvals: Vec<Address>,
    pub first_seen_at: u64,
}

/// Result of a `submit_index` call, so a signer learns whether their signature
/// finalized the reading without a follow-up RPC round trip.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubmissionOutcome {
    pub region_id: Symbol,
    pub timestamp: u64,
    pub index_value: i128,
    pub approvals: u32,
    pub threshold: u32,
    pub finalized: bool,
}

impl PendingReading {
    pub fn approval_count(&self) -> u32 {
        self.approvals.len()
    }

    pub fn has_approved(&self, signer: &Address) -> bool {
        self.approvals.iter().any(|a| a == *signer)
    }
}
