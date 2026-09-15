//! Contract error codes for [`crate::PayoutEngine`].
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
    /// The caller failed the admin authorisation check.
    Unauthorized = 3,
    /// A configuration address is the engine itself, which would deadlock it.
    SelfReference = 4,
    /// Two configuration slots were given the same address.
    DuplicateContract = 5,
    /// The registry holds no policy under the supplied id.
    PolicyNotFound = 6,
    /// The policy is already settled, cancelled or expired.
    PolicyNotActive = 7,
    /// The registry rejected a state transition.
    RegistryCallFailed = 8,
    /// The premium pool rejected a payout or a liability update.
    PoolCallFailed = 9,
    /// The oracle adapter could not be read.
    OracleCallFailed = 10,
    /// The registry/pool does not have this engine registered as its payout
    /// engine, so it could never actually move money.
    EngineNotRegistered = 11,
    /// Liability was already recognised for this policy.
    LiabilityAlreadyRegistered = 12,
    /// The clock has not passed `coverage_end`, so the policy cannot be expired
    /// yet: the registry opens expiry one second after a window closes.
    CoverageStillOpen = 13,
    /// Liability may only be dropped for a policy that is no longer live.
    PolicyStillActive = 14,
}
