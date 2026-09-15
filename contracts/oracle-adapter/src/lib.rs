#![no_std]
//! # AgriShield · OracleAdapter
//!
//! Turns independently published weather observations into a single finalized
//! index value per region that the payout engine can trust.
//!
//! ## Trust model
//! No single party can move money. A reading only becomes **finalized** when at
//! least `threshold` distinct authorised signers submit the *same*
//! `(region_id, timestamp, index_value)` triple:
//!
//! 1. Each signer calls [`OracleAdapter::submit_index`] with its own signature.
//! 2. The first submission opens a `PendingReading`; later signers append to it.
//! 3. A signer that submits a different value for the same timestamp is
//!    rejected with [`Error::ConflictingValue`] — the vote cannot be split.
//! 4. When approvals reach the threshold the reading is written to
//!    `Latest`/`History`, the pending entry is deleted, and
//!    `IndexFinalized` is emitted.
//!
//! ## Invariants
//! * Readings for a region are strictly monotonic in `timestamp`: an older
//!   observation can never overwrite newer state.
//! * A `(region, timestamp)` pair finalizes at most once; re-submissions after
//!   finalization are rejected.
//! * `threshold` is always `>= 1` and `<= signer_count` once the set is wired;
//!   removing a signer that would make the threshold unsatisfiable reverts.
//! * History is a bounded ring per region, so an attacker cannot inflate storage
//!   by publishing endlessly.

mod error;
mod events;
mod storage;
mod threshold;
mod types;

#[cfg(test)]
mod tests;

pub use crate::error::Error;
pub use crate::events::{
    ApprovalRecorded, IndexFinalized, SignerAdded, SignerRemoved, ThresholdChanged,
};
pub use crate::storage::DataKey;
pub use crate::threshold::{can_remove_signer, proximity, reached, validate_threshold};
pub use crate::types::{
    IndexReading, PendingReading, SubmissionOutcome, MAX_FUTURE_SKEW_SECONDS,
    MAX_HISTORY_PER_REGION, MAX_INDEX_VALUE, MAX_SIGNERS,
};

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};

/// Storage-facing implementation of the AgriShield oracle adapter.
#[contract]
pub struct OracleAdapter;

#[contractimpl]
impl OracleAdapter {
    // -----------------------------------------------------------------------
    // Lifecycle & signer administration
    // -----------------------------------------------------------------------

    /// Wires the adapter. `threshold` is the number of distinct signer approvals
    /// required before a reading is considered final; it must be at least 1 and
    /// is validated against the signer set by [`Self::set_threshold`] once
    /// signers exist.
    pub fn initialize(env: Env, admin: Address, threshold: u32) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_threshold(&env, threshold);
        Ok(())
    }

    /// Registers an authorised oracle signer. Admin-only.
    pub fn add_signer(env: Env, admin: Address, signer: Address) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;

        let mut signers = storage::get_signers(&env);
        if signers.iter().any(|s| s == signer) {
            return Err(Error::SignerAlreadyRegistered);
        }
        threshold::validate_signer_capacity(signers.len(), MAX_SIGNERS)?;

        signers.push_back(signer.clone());
        storage::set_signers(&env, &signers);
        events::signer_added(
            &env,
            &SignerAdded {
                signer,
                signer_count: signers.len(),
            },
        );
        Ok(())
    }

    /// Removes a signer. Admin-only. Refuses to leave the threshold
    /// unsatisfiable, which would permanently freeze the region's settlements.
    pub fn remove_signer(env: Env, admin: Address, signer: Address) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;

        let signers = storage::get_signers(&env);
        let threshold = storage::get_threshold(&env)?;
        let mut next = Vec::new(&env);
        let mut found = false;
        for entry in signers.iter() {
            if entry == signer {
                found = true;
            } else {
                next.push_back(entry);
            }
        }
        if !found {
            return Err(Error::SignerNotRegistered);
        }
        // The guard is expressed on the *current* set: removing one signer is
        // safe only while the remaining count still satisfies the threshold.
        if !threshold::can_remove_signer(signers.len(), threshold) {
            return Err(Error::SignerSetTooSmall);
        }

        storage::set_signers(&env, &next);
        events::signer_removed(
            &env,
            &SignerRemoved {
                signer,
                signer_count: next.len(),
            },
        );
        Ok(())
    }

    /// Updates the approval threshold. Admin-only and bounded by the signer set.
    pub fn set_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), Error> {
        admin.require_auth();
        storage::require_admin(&env, &admin)?;
        let signer_count = storage::get_signers(&env).len();
        threshold::validate_threshold(threshold, signer_count)?;
        storage::set_threshold(&env, threshold);
        events::threshold_changed(
            &env,
            &ThresholdChanged {
                threshold,
                signer_count,
            },
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Index submission
    // -----------------------------------------------------------------------

    /// Records one signer's approval of `(region_id, timestamp, index_value)`.
    ///
    /// Returns a [`SubmissionOutcome`] telling the caller whether this approval
    /// finalized the reading. Safe to call concurrently; each signer must hold
    /// its own key.
    pub fn submit_index(
        env: Env,
        signer: Address,
        region_id: Symbol,
        index_value: i128,
        timestamp: u64,
    ) -> Result<SubmissionOutcome, Error> {
        if !storage::is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        signer.require_auth();
        storage::require_signer(&env, &signer)?;

        let threshold = storage::get_threshold(&env)?;
        validate_index_value(index_value)?;

        let now = env.ledger().timestamp();
        if timestamp > now + MAX_FUTURE_SKEW_SECONDS {
            return Err(Error::FutureTimestamp);
        }
        if storage::is_finalized(&env, &region_id, timestamp) {
            return Err(Error::ReadingAlreadyFinalized);
        }
        if let Ok(latest) = storage::get_latest(&env, &region_id) {
            if timestamp <= latest.timestamp {
                return Err(Error::StaleReading);
            }
        }

        let mut pending = match storage::get_pending(&env, &region_id, timestamp) {
            Some(existing) => existing,
            None => PendingReading {
                region_id: region_id.clone(),
                index_value,
                timestamp,
                approvals: Vec::new(&env),
                first_seen_at: now,
            },
        };

        // Rejects duplicate signatures and any value that disagrees with the
        // in-flight consensus for this timestamp.
        threshold::validate_approval(&pending, &signer, index_value)?;
        pending.approvals.push_back(signer.clone());
        let approvals = pending.approval_count();

        if threshold::reached(approvals, threshold) {
            let reading = IndexReading {
                region_id: region_id.clone(),
                index_value,
                timestamp,
                finalized_at: now,
                approvals,
            };
            storage::set_latest(&env, &reading);
            storage::push_history(&env, &reading, MAX_HISTORY_PER_REGION);
            storage::remove_pending(&env, &region_id, timestamp);
            events::index_finalized(&env, &reading);

            return Ok(SubmissionOutcome {
                region_id,
                timestamp,
                index_value,
                approvals,
                threshold,
                finalized: true,
            });
        }

        storage::set_pending(&env, &pending);
        events::approval_recorded(
            &env,
            &ApprovalRecorded {
                region_id: region_id.clone(),
                timestamp,
                signer,
                approvals,
                threshold,
            },
        );

        Ok(SubmissionOutcome {
            region_id,
            timestamp,
            index_value,
            approvals,
            threshold,
            finalized: false,
        })
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Newest finalized reading for a region.
    pub fn get_latest_index(env: Env, region_id: Symbol) -> Result<IndexReading, Error> {
        storage::get_latest(&env, &region_id)
    }

    /// Whether the region has any finalized reading at all.
    pub fn has_reading(env: Env, region_id: Symbol) -> bool {
        storage::has_latest(&env, &region_id)
    }

    /// In-flight reading plus the approvals collected so far.
    pub fn get_pending_reading(
        env: Env,
        region_id: Symbol,
        timestamp: u64,
    ) -> Result<PendingReading, Error> {
        storage::get_pending(&env, &region_id, timestamp).ok_or(Error::NoPendingReading)
    }

    /// Bounded, oldest-first history used by the frontend's index chart.
    pub fn get_index_history(env: Env, region_id: Symbol) -> Vec<IndexReading> {
        storage::get_history(&env, &region_id)
    }

    /// Whether a reading exists for the exact `(region, timestamp)` pair.
    pub fn is_finalized(env: Env, region_id: Symbol, timestamp: u64) -> bool {
        storage::is_finalized(&env, &region_id, timestamp)
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        storage::get_signers(&env)
    }

    pub fn get_threshold(env: Env) -> Result<u32, Error> {
        storage::get_threshold(&env)
    }

    pub fn is_signer(env: Env, who: Address) -> bool {
        storage::is_signer(&env, &who)
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        storage::get_admin(&env)
    }
}

/// Sanity band for index values. Rejects negative and absurdly large readings
/// before they can reach the payout engine's arithmetic.
fn validate_index_value(index_value: i128) -> Result<(), Error> {
    if index_value < 0 {
        return Err(Error::InvalidIndexValue);
    }
    if index_value > MAX_INDEX_VALUE {
        return Err(Error::IndexOutOfRange);
    }
    Ok(())
}
