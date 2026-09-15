//! Contract error codes for [`crate::PolicyRegistry`].
//!
//! Every fallible entry point returns `Result<_, Error>` so callers (and the
//! Soroban host) get a deterministic numeric code instead of an opaque trap.
//! Codes are part of the public ABI: never renumber an existing variant, only
//! append new ones.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// `initialize` was called on a contract that already has an admin.
    AlreadyInitialized = 1,
    /// A state-changing call happened before `initialize`.
    NotInitialized = 2,
    /// The caller failed an admin/owner authorisation check.
    Unauthorized = 3,
    /// `coverage_end` is not strictly after `coverage_start`.
    InvalidCoverageWindow = 4,
    /// The coverage window is shorter than the mandated minimum.
    CoverageWindowTooShort = 5,
    /// The coverage window is already in the past when the policy is created.
    CoverageWindowInPast = 6,
    /// `premium` was zero or negative.
    InvalidPremium = 7,
    /// `payout_amount` was zero or negative.
    InvalidPayout = 8,
    /// `trigger_threshold` was negative (index values are non-negative).
    InvalidThreshold = 9,
    /// A policy on the same plot already covers an overlapping window.
    DuplicateActivePolicy = 10,
    /// A plot already reached the per-plot policy cap.
    PlotPolicyLimitReached = 11,
    /// No policy exists for the supplied id.
    PolicyNotFound = 12,
    /// The policy was already settled, cancelled or expired.
    PolicyNotActive = 13,
    /// Escrowing the premium failed (usually insufficient token balance).
    PremiumTransferFailed = 14,
}
