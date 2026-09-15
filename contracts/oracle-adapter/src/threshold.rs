//! Pure helpers for the N-of-M signer policy.
//!
//! Kept free of storage access so the trust-model rules are unit-testable on
//! their own and reusable by the backend's oracle aggregator.

use soroban_sdk::Address;

use crate::error::Error;
use crate::types::PendingReading;

/// A threshold must be non-zero and satisfiable by the current signer set.
pub fn validate_threshold(threshold: u32, signer_count: u32) -> Result<(), Error> {
    if threshold == 0 || threshold > signer_count {
        return Err(Error::InvalidThreshold);
    }
    Ok(())
}

/// True once `approvals` has at least `threshold` co-signers.
pub fn reached(approvals: u32, threshold: u32) -> bool {
    approvals >= threshold
}

/// True when removing one signer would still leave the threshold satisfiable.
pub fn can_remove_signer(signer_count: u32, threshold: u32) -> bool {
    signer_count > threshold
}

/// Fails when the signer set is already at the cap, keeping the approval scan
/// and the storage footprint bounded.
pub fn validate_signer_capacity(signer_count: u32, cap: u32) -> Result<(), Error> {
    if signer_count >= cap {
        return Err(Error::SignerSetFull);
    }
    Ok(())
}

/// Validates an incoming signature against the in-flight reading.
///
/// Returns the error the caller should raise, or `Ok(())` when the approval is
/// acceptable and should be recorded.
pub fn validate_approval(
    pending: &PendingReading,
    signer: &Address,
    index_value: i128,
) -> Result<(), Error> {
    if pending.index_value != index_value {
        return Err(Error::ConflictingValue);
    }
    if pending.has_approved(signer) {
        return Err(Error::DuplicateApproval);
    }
    Ok(())
}

/// The "distance" of a value from the trigger used by the notification service
/// to warn farmers that a payout is close. Returns 0 when already triggered.
pub fn proximity(index_value: i128, trigger_threshold: i128) -> i128 {
    let distance = index_value - trigger_threshold;
    if distance < 0 {
        0
    } else {
        distance
    }
}
