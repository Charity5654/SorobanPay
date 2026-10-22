use soroban_sdk::{contracttype, Address, Env};

// ==================== Version Metadata ====================
/// Contract semantic version: MAJOR.MINOR.PATCH
/// Increment MAJOR for breaking changes, MINOR for new backwards-compatible features, PATCH for bug fixes
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Contract version as numeric components for off-chain compatibility checks
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;

/// Human-readable contract identifier for integration verification
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

// ==================== Storage Version ====================

/// Monotonically increasing integer that identifies the on-chain storage schema.
///
/// Rules:
/// - Bump by 1 on every breaking change to `SubscriptionData` or `DataKey`.
/// - Never reuse a value; old values are permanently recorded in migration logic.
/// - Version 1 corresponds to the initial `SubscriptionData` layout (token, amount,
///   interval, next_payment, is_paused).
pub const STORAGE_VERSION: u32 = 1;

/// Singleton key that stores the current schema version in instance storage.
/// Using instance storage guarantees that the version entry lives as long as
/// the contract instance itself and is never accidentally evicted by TTL.
#[contracttype]
pub enum MetaKey {
    /// Current on-chain storage schema version (u32).
    StorageVersion,
}

// ==================== Migration ====================

/// Outcome returned by [`ensure_storage_version`].
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// Storage was already at the expected version — nothing was written.
    AlreadyCurrent,
    /// Storage was absent or at an older version — schema was initialised/migrated.
    Migrated { from: u32 },
}

/// Ensure that on-chain instance storage is at `STORAGE_VERSION`.
///
/// # Behaviour
/// 1. Reads the current version from instance storage (`MetaKey::StorageVersion`).
///    - If absent, treats it as version `0` (pre-versioning, first deploy).
/// 2. If `current == STORAGE_VERSION` — returns `Ok(MigrationOutcome::AlreadyCurrent)`.
/// 3. If `current < STORAGE_VERSION` — runs migration steps for every version from
///    `current + 1` to `STORAGE_VERSION` (inclusive), then writes the new version.
/// 4. If `current > STORAGE_VERSION` — the binary is older than the stored schema;
///    returns `Err(StorageVersionError::DowngradeRejected)`.
///
/// # When to call
/// Call this function at the top of any entry point that reads or writes persistent
/// subscription records to ensure the schema is compatible before touching data.
/// Because instance storage has no TTL management requirement here (the contract
/// instance persists as long as the account exists), no `extend_ttl` is needed.
///
/// # Idempotency
/// Calling this function multiple times in the same transaction is safe: the first
/// call performs the migration and writes the new version; subsequent calls find
/// the version already current and return `AlreadyCurrent` immediately.
pub fn ensure_storage_version(env: &Env) -> Result<MigrationOutcome, StorageVersionError> {
    let current: u32 = env
        .storage()
        .instance()
        .get(&MetaKey::StorageVersion)
        .unwrap_or(0u32);

    if current == STORAGE_VERSION {
        return Ok(MigrationOutcome::AlreadyCurrent);
    }

    if current > STORAGE_VERSION {
        return Err(StorageVersionError::DowngradeRejected { found: current });
    }

    // Execute incremental migration steps from (current + 1) to STORAGE_VERSION.
    // Each arm must handle exactly one version transition and is intentionally
    // exhaustive so that a future version bump forces the author to add a case.
    let from_version = current;
    let mut v = current;
    while v < STORAGE_VERSION {
        v += 1;
        match v {
            1 => {
                // Version 0 → 1: initial schema introduction.
                // The SubscriptionData struct (token, amount, interval, next_payment,
                // is_paused) has been the only layout since genesis, so no field
                // transformations are needed. This step simply records the baseline.
            }
            // Future versions: add migration arms here, e.g.:
            //   2 => { /* rename / add / remove fields */ }
            _ => {
                // Unreachable for valid STORAGE_VERSION values; kept as a safety net.
                return Err(StorageVersionError::UnknownVersion { version: v });
            }
        }
    }

    // Persist the new version.
    env.storage()
        .instance()
        .set(&MetaKey::StorageVersion, &STORAGE_VERSION);

    Ok(MigrationOutcome::Migrated { from: from_version })
}

/// Errors produced by the storage migration subsystem.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum StorageVersionError {
    /// The on-chain version is *newer* than this binary knows about.
    /// Calling code must abort rather than corrupt data with an older schema.
    DowngradeRejected { found: u32 },
    /// The migration loop encountered a version number it has no handler for.
    /// This should be unreachable in correct builds.
    UnknownVersion { version: u32 },
}

// ==================== Storage & Data Structures ====================

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
    pub is_paused:    bool,      // true if subscription payments are suspended
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
///
/// Stellar Asset Contract (SAC) balances are represented as i64 internally, so
/// the theoretical maximum is i64::MAX ≈ 9.2 × 10¹⁸.  We cap at 1 × 10¹⁸ to:
///   - stay comfortably below i64::MAX and avoid edge-case overflow in downstream
///     arithmetic (e.g. fee calculations, multi-hop aggregations);
///   - prevent accidental fat-finger amounts that would drain a subscriber in a
///     single interval;
///   - keep the value human-readable (10¹² XLM at 10⁶ stroops/XLM — far beyond
///     any realistic subscription use-case).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18 stroops

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// Maximum TTL ceiling (~365 days at 5 s/ledger = 6 307 200 ledgers).
///
/// Used as the `extend_to` argument to `extend_ttl`: when an extension is
/// needed, the entry's TTL is bumped up to this value. Guarantees that an
/// active subscription survives a full annual billing cycle without expiring.
/// Stale subscriptions that go a full year without a successful payment will
/// expire and be garbage-collected by the Soroban host automatically.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ==================== Storage Version Migration Tests ====================

#[cfg(test)]
mod storage_version_tests {
    use super::*;
    use soroban_sdk::Env;

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Read the raw version stored in instance storage (None if absent).
    fn read_stored_version(env: &Env) -> Option<u32> {
        env.storage().instance().get(&MetaKey::StorageVersion)
    }

    // ── Success paths ─────────────────────────────────────────────────────────

    /// A brand-new deployment has no version in storage (None / 0).
    /// `ensure_storage_version` must migrate from 0 → STORAGE_VERSION and return Migrated.
    #[test]
    fn test_fresh_deploy_migrates_from_zero() {
        let env = Env::default();
        assert_eq!(read_stored_version(&env), None, "no version on fresh env");

        let outcome = ensure_storage_version(&env).expect("migration must succeed");
        assert_eq!(
            outcome,
            MigrationOutcome::Migrated { from: 0 },
            "fresh deploy should report Migrated {{ from: 0 }}"
        );
        assert_eq!(
            read_stored_version(&env),
            Some(STORAGE_VERSION),
            "version must be written after migration"
        );
    }

    /// Calling `ensure_storage_version` a second time on an already-current schema
    /// must return `AlreadyCurrent` and must NOT modify the stored value.
    #[test]
    fn test_already_current_is_idempotent() {
        let env = Env::default();

        // First call migrates.
        ensure_storage_version(&env).unwrap();

        // Second call must be a no-op.
        let outcome = ensure_storage_version(&env).expect("second call must succeed");
        assert_eq!(
            outcome,
            MigrationOutcome::AlreadyCurrent,
            "second call must return AlreadyCurrent"
        );
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    /// Calling `ensure_storage_version` many times consecutively is safe and always
    /// returns `AlreadyCurrent` after the first successful migration.
    #[test]
    fn test_idempotent_repeated_calls() {
        let env = Env::default();

        // Migrate once.
        ensure_storage_version(&env).unwrap();

        // 10 subsequent calls must all return AlreadyCurrent.
        for i in 0..10 {
            let outcome = ensure_storage_version(&env).expect("repeated call must succeed");
            assert_eq!(
                outcome,
                MigrationOutcome::AlreadyCurrent,
                "call {} must return AlreadyCurrent",
                i
            );
        }
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    /// If a test manually sets the version to the current value, `ensure_storage_version`
    /// must still return `AlreadyCurrent` without re-running any migration step.
    #[test]
    fn test_explicit_current_version_returns_already_current() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &STORAGE_VERSION);

        let outcome = ensure_storage_version(&env).unwrap();
        assert_eq!(outcome, MigrationOutcome::AlreadyCurrent);
    }

    // ── Boundary: version == 0 is treated as "unversioned" ───────────────────

    /// Explicitly writing version 0 simulates a legacy deployment that predates
    /// the versioning system.  Migration must succeed and produce Migrated { from: 0 }.
    #[test]
    fn test_version_zero_treated_as_unversioned() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &0u32);

        let outcome = ensure_storage_version(&env).unwrap();
        assert_eq!(outcome, MigrationOutcome::Migrated { from: 0 });
        assert_eq!(read_stored_version(&env), Some(STORAGE_VERSION));
    }

    // ── Downgrade rejection ───────────────────────────────────────────────────

    /// A stored version *newer* than the binary's `STORAGE_VERSION` must be rejected
    /// with `DowngradeRejected`.  This prevents an older binary from corrupting data
    /// written by a newer one.
    #[test]
    fn test_downgrade_rejected_when_stored_version_is_newer() {
        let env = Env::default();
        let future_version = STORAGE_VERSION + 1;
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &future_version);

        let err = ensure_storage_version(&env)
            .expect_err("downgrade must be rejected");
        assert_eq!(
            err,
            StorageVersionError::DowngradeRejected { found: future_version },
            "error must report the found version"
        );
        // The stored version must not be overwritten.
        assert_eq!(read_stored_version(&env), Some(future_version));
    }

    /// Any stored version strictly greater than STORAGE_VERSION must be rejected,
    /// regardless of how far ahead it is.
    #[test]
    fn test_downgrade_rejected_for_any_future_version() {
        for delta in [1u32, 5, 100, u32::MAX - STORAGE_VERSION] {
            let env = Env::default();
            let future = STORAGE_VERSION + delta;
            env.storage()
                .instance()
                .set(&MetaKey::StorageVersion, &future);

            let err = ensure_storage_version(&env)
                .expect_err("any future version must be rejected");
            assert!(
                matches!(err, StorageVersionError::DowngradeRejected { found } if found == future),
                "delta={delta}: expected DowngradeRejected {{ found: {future} }}, got {err:?}"
            );
        }
    }

    // ── MigrationOutcome equality / Debug ────────────────────────────────────

    /// Verify that `MigrationOutcome` variants implement `PartialEq` correctly.
    #[test]
    fn test_migration_outcome_eq() {
        assert_eq!(MigrationOutcome::AlreadyCurrent, MigrationOutcome::AlreadyCurrent);
        assert_eq!(
            MigrationOutcome::Migrated { from: 0 },
            MigrationOutcome::Migrated { from: 0 }
        );
        assert_ne!(
            MigrationOutcome::AlreadyCurrent,
            MigrationOutcome::Migrated { from: 0 }
        );
        assert_ne!(
            MigrationOutcome::Migrated { from: 0 },
            MigrationOutcome::Migrated { from: 1 }
        );
    }

    /// Verify that `StorageVersionError` variants implement `PartialEq` correctly.
    #[test]
    fn test_storage_version_error_eq() {
        assert_eq!(
            StorageVersionError::DowngradeRejected { found: 5 },
            StorageVersionError::DowngradeRejected { found: 5 }
        );
        assert_ne!(
            StorageVersionError::DowngradeRejected { found: 5 },
            StorageVersionError::DowngradeRejected { found: 6 }
        );
        assert_eq!(
            StorageVersionError::UnknownVersion { version: 99 },
            StorageVersionError::UnknownVersion { version: 99 }
        );
    }

    // ── Adversarial: u32::MAX stored version ─────────────────────────────────

    /// `u32::MAX` stored version (adversarial input) must be rejected cleanly
    /// without panicking or overflowing.
    #[test]
    fn test_u32_max_stored_version_rejected() {
        let env = Env::default();
        env.storage()
            .instance()
            .set(&MetaKey::StorageVersion, &u32::MAX);

        let err = ensure_storage_version(&env)
            .expect_err("u32::MAX version must be rejected");
        assert!(
            matches!(err, StorageVersionError::DowngradeRejected { found: u32::MAX }),
            "expected DowngradeRejected with u32::MAX"
        );
    }
}
