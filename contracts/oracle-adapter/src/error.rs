//! Contract error codes for [`crate::OracleAdapter`].
//!
//! Numeric codes are public ABI; append only.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `initialize` was called twice.
    AlreadyInitialized = 1,
    /// A call arrived before `initialize`.
    NotInitialized = 2,
    /// The caller failed an admin check.
    Unauthorized = 3,
    /// The submitting address is not in the signer set.
    NotASigner = 4,
    /// Threshold was zero or larger than the signer set.
    InvalidThreshold = 5,
    /// The signer is already registered.
    SignerAlreadyRegistered = 6,
    /// The signer is not registered (nothing to remove).
    SignerNotRegistered = 7,
    /// The removal would leave fewer signers than the threshold.
    SignerSetTooSmall = 8,
    /// This signer already co-signed the reading.
    DuplicateApproval = 9,
    /// The signer submitted a different value for the same (region, timestamp).
    ConflictingValue = 10,
    /// The timestamp is not newer than the latest finalized reading.
    StaleReading = 11,
    /// A reading for this (region, timestamp) is already finalized.
    ReadingAlreadyFinalized = 12,
    /// No pending reading exists for the region/timestamp.
    NoPendingReading = 13,
    /// The timestamp is too far in the future to be a real observation.
    FutureTimestamp = 14,
    /// Negative index values are not valid weather indices.
    InvalidIndexValue = 15,
    /// The per-region history ring reached its cap.
    HistoryLimitReached = 16,
    /// The region has no finalized reading yet.
    NoReading = 17,
    /// Index value is outside the sanity band accepted by the adapter.
    IndexOutOfRange = 18,
    /// The signer set is at its cap; remove a signer before adding another.
    SignerSetFull = 19,
}
