//! Contract error codes for [`crate::PremiumPool`].
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
    /// The caller failed an admin/engine authorisation check.
    Unauthorized = 3,
    /// Amount was zero or negative.
    InvalidAmount = 4,
    /// The withdrawal would push reserves below the minimum solvency ratio.
    InsolventWithdrawal = 5,
    /// Reserves cannot cover the requested payout.
    InsufficientReserves = 6,
    /// Solvency ratio outside the accepted band.
    InvalidRatio = 7,
    /// The token transfer failed (usually the payer has no balance).
    TransferFailed = 8,
    /// Releasing more liability than is currently recognised.
    LiabilityUnderflow = 9,
    /// The pool would have a negative reserve balance after the operation.
    NegativeReserves = 10,
}
