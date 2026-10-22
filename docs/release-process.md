# Release Process

This document describes how to cut a SorobanPay release: versioning conventions,
changelog hygiene, release note template, and the step-by-step checklist.

---

## Table of Contents

1. [Versioning](#1-versioning)
2. [Compatibility Policy](#2-compatibility-policy)
3. [Changelog Hygiene](#3-changelog-hygiene)
4. [Release Note Template](#4-release-note-template)
5. [Step-by-Step Release Checklist](#5-step-by-step-release-checklist)
6. [Component-Specific Notes](#6-component-specific-notes)
7. [After Release](#7-after-release)

---

## 1. Versioning

SorobanPay follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`):

| Version bump | When |
|-------------|------|
| `MAJOR` | Breaking change to any public interface — contract entry points, event schemas, error codes, or frontend API |
| `MINOR` | New backwards-compatible feature — new entry point, new event type, new frontend component, new deploy option |
| `PATCH` | Bug fix, documentation correction, dependency update with no user-visible change |

The contract version is defined in `contracts/subscription/src/storage.rs`:

```rust
pub const CONTRACT_VERSION: &str = "1.0.0";
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;
```

The frontend version is tracked in `frontend/package.json` (`"version"` field).

**All three version strings must match** at the time of a release tag unless you are intentionally releasing only one component (e.g., a documentation-only patch).

---

## 2. Compatibility Policy

This section defines what "compatible" means for each component and which changes require a `MAJOR` version bump.

### 2.1 Contract WASM compatibility

The Soroban contract is **immutable after deployment**. A new deployment produces a new contract address; there is no in-place upgrade path for existing subscribers.

#### Breaking changes (require `MAJOR` bump + new deployment)

| Change | Reason |
|--------|--------|
| Rename or remove an entry point (`subscribe`, `execute_payment`, `cancel`, …) | Breaks all integrators calling the old name |
| Change the argument list of an entry point (add required parameter, remove parameter, change type) | Existing call sites will fail |
| Change the error code assigned to an existing error variant | Off-chain monitoring and retry logic keyed on error codes will misfire |
| Change an event's topic structure (number of topics, topic types, discriminant symbol) | Event indexers and merchants relying on the existing schema will decode incorrectly |
| Change the data field type of an existing event (e.g., `i128` → `u64`) | Same as above |
| Change the storage key schema for `SubscriptionData` | Existing entries become unreadable by the new contract |
| Rename or remove a field in `SubscriptionData` | Deserialization of existing persistent entries fails |

#### Non-breaking changes (allow `MINOR` or `PATCH` bump)

| Change | Reason |
|--------|--------|
| Add a new entry point | Existing call sites are unaffected; new callers opt in |
| Add a new event type (new discriminant symbol) | Existing indexers ignore unknown event types; new indexers can subscribe |
| Add an optional field to `SubscriptionData` (requires upgrade-regression test) | Existing entries decode with the field absent/defaulted |
| Internal refactor with no ABI change | No observable difference to callers |
| Update `soroban-sdk` within the same major version | No host interface change |
| Change a constant (e.g., `MIN_TTL_LEDGERS`) | Does not affect deployed entry-point ABI |

#### Contract upgrade procedure

Because Soroban contracts are immutable:

1. Deploy the new contract to testnet and run the full test suite (including TEST-103 upgrade regressions).
2. Announce the new contract address at least **72 hours** before mainnet deprecation of the old address.
3. Deploy to mainnet.
4. Update `NEXT_PUBLIC_CONTRACT_ID` in the frontend production environment and redeploy.
5. Update `CONTRACT_ID` in the backend environment and restart.
6. Notify all merchants and integrators — they must update their `CONTRACT_ID` references.
7. Instruct subscribers to re-subscribe on the new contract address. Existing on-chain subscriptions **are not portable**.
8. Keep the old contract address accessible (i.e., do not de-fund the deploying account) for a **30-day migration window** so existing subscriptions can complete their final payment cycle.

### 2.2 REST API compatibility

The backend REST API uses URL path versioning (`/v1/`, `/v2/`).

#### Breaking changes (require new `/v2/` route + `MAJOR` bump)

| Change | Reason |
|--------|--------|
| Remove an endpoint | Existing integrations break |
| Change an endpoint's URL path or HTTP method | Clients must update call sites |
| Remove a field from a response body | Clients that depend on the field break |
| Change a field's type or format in a response | Clients that parse the field break |
| Change the meaning of an existing error code or HTTP status | Monitoring and retry logic breaks |
| Remove a required query parameter | Existing calls may behave unexpectedly |

#### Non-breaking changes

| Change | Reason |
|--------|--------|
| Add a new endpoint | Existing clients are unaffected |
| Add a new optional field to a response body | Clients ignore unknown fields (forward-compatible JSON) |
| Add a new optional query parameter | Existing calls omit it and behave as before |
| Change the default sort order for consistency | Low risk; document in changelog |
| Add a new optional request body field | Clients omit it; server uses the default |

#### API versioning strategy

- The current API version is `/v1/`. The version prefix is included in every base URL.
- A new major version (`/v2/`) is deployed alongside `/v1/` for a **90-day parallel-run window** before `/v1/` is retired.
- Deprecation notices are added to API responses via the `Deprecation` and `Sunset` HTTP headers:
  ```
  Deprecation: true
  Sunset: Mon, 31 Mar 2027 00:00:00 GMT
  ```

### 2.3 GraphQL API compatibility

The GraphQL schema follows the same compatibility rules as the REST API.

#### Breaking changes (require schema version bump and `MAJOR` bump)

| Change |
|--------|
| Remove a type, field, or argument |
| Change a field's type to a narrower type (e.g., `String!` → `ID!`) |
| Change a required argument to a different type |
| Remove an enum value that callers currently use |

#### Non-breaking changes

| Change |
|--------|
| Add a new type, field, or argument (nullable) |
| Add a new optional argument with a default value |
| Add a new enum value |
| Deprecate a field with `@deprecated(reason: "…")` |

### 2.4 Database migration compatibility

Database migrations are applied with `npx prisma migrate deploy` (never auto-applied on startup in production).

#### Rules for migration authoring

| Rule | Rationale |
|------|-----------|
| All migrations must be **additive by default** (add columns, add tables) | Removes and renames require a deprecation window |
| New non-nullable columns must include a `DEFAULT` value or be added in two steps (add nullable → backfill → add NOT NULL constraint) | Zero-downtime deployments; prevents lock escalation on large tables |
| Never rename a column in a single migration | Rename = add new column + backfill + drop old column, in separate migrations |
| Never drop a column or table in the same release that stops writing to it | Give the app one full release cycle with the column unused before dropping |
| Index additions should use `CONCURRENTLY` on PostgreSQL | Avoids table locks in production |
| Each migration file must be idempotent | Protects against accidental re-runs |

#### Migration numbering

Migration files are in `backend/migrations/` and follow the naming pattern:

```
YYYYMMDDHHMMSS_<descriptive_slug>.js
```

Never re-number or rename a migration file after it has been applied to any environment. The migration history table (`_prisma_migrations`) tracks files by name.

### 2.5 Event schema compatibility

On-chain Soroban events are the primary integration surface for external indexers and merchant tooling. Event schema changes are therefore subject to the **same breaking-change rules as contract WASM changes** (see §2.1).

#### Current event schemas (v1)

| Event | Topics | Data | Breaking change if… |
|-------|--------|------|---------------------|
| `subscribe` | `(symbol("subscribe"), subscriber, merchant, token)` | `amount: i128` | Topics reordered, symbol renamed, data field type changes |
| `executed` | `(symbol("executed"), subscriber, merchant, token)` | `amount: i128` | Same as above |
| `payment_transfer_failure` | `(symbol("payment_transfer_failure"), subscriber, merchant)` | `amount: i128` | Same as above |
| `cancel` | `(symbol("cancel"), subscriber, merchant)` | `()` | Topics reordered, data type changes |

#### Adding new event fields

New data can be appended to the `data` XDR value **only if** it is optional and the existing decoders are tolerant of additional bytes (i.e., they use `scValToNative` which ignores trailing fields). Document the change in `docs/events.md` and bump the event schema version in that document.

#### Removing or changing existing event fields

Requires a `MAJOR` version bump, a new contract deployment, and a migration guide explaining how indexers should handle both old and new event formats during the transition window.

### 2.6 Compatibility matrix summary

Use this table at release time to determine the version bump type for each changed component:

| Component changed | No breaking change | Breaking change |
|------------------|-------------------|-----------------|
| Contract WASM (entry points, storage, events) | `MINOR` or `PATCH` | `MAJOR` — new deployment required |
| REST API (`/v1/`) | `MINOR` or `PATCH` | `MAJOR` — new `/v2/` route required |
| GraphQL schema | `MINOR` or `PATCH` | `MAJOR` — schema version bump required |
| Database migrations | `PATCH` (additive) | `MAJOR` (destructive: remove/rename) |
| Event schemas | `MINOR` (new event) | `MAJOR` (existing event changed) |
| Frontend UI/UX | `MINOR` (new feature) | `PATCH` (bug fix, no API change) |
| Backend workers / services | `PATCH` (internal) | `MINOR` (new observable behavior) |
| CI / deploy scripts | `PATCH` | `MINOR` (new required env var) |
| Documentation only | `PATCH` | N/A |

---

## 3. Changelog Hygiene

`CHANGELOG.md` (project root) follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### The Unreleased section

Every pull request that changes observable behaviour **must** include an entry in the `## [Unreleased]` section. The CI `check-changelog` job fails if this section is empty on a PR that modifies non-doc files.

Entries go under the appropriate sub-heading:

| Sub-heading | What belongs here |
|-------------|------------------|
| `### Added` | New features, new entry points, new env vars, new docs pages |
| `### Changed` | Behaviour changes that are backwards-compatible |
| `### Deprecated` | Features that will be removed in a future release |
| `### Removed` | Features removed in this release |
| `### Fixed` | Bug fixes |
| `### Security` | Security fixes — reference the advisory or CVE |

### Entry format

Each entry is a single bullet:

```
- **[Component]** Short imperative description. (Closes #<issue>)
```

Component tags: `[Contract]`, `[Frontend]`, `[Backend]`, `[Deploy]`, `[Docs]`, `[CI]`.

**Examples:**

```markdown
### Added
- **[Contract]** Add `batch_execute_payment` entry point (up to 50 subscribers per call). (Closes #210)
- **[Frontend]** Show QR code share button on subscription form. (Closes #198)
- **[Deploy]** Document all `deploy.sh` environment variables in `docs/deployment.md`. (Closes #77)

### Fixed
- **[Contract]** Prevent self-subscription where `subscriber == merchant`. (Closes #185)
- **[Frontend]** Fix double-submission on slow Freighter response. (Closes #201)

### Security
- **[Contract]** Add `strict` mode to `subscribe` to reject insufficient allowances. See GHSA-xxxx-xxxx.
```

---

## 4. Release Note Template

When cutting a release, promote the `[Unreleased]` section to a versioned section and fill in this template.

Copy this block into `CHANGELOG.md` immediately above `## [Unreleased]`:

```markdown
## [X.Y.Z] — YYYY-MM-DD

> One-sentence summary of the release theme (e.g., "Adds batch payment collection and hardens allowance validation.").

### Added
-

### Changed
-

### Deprecated
-

### Removed
-

### Fixed
-

### Security
-

### Contract

<!-- List any changes to the on-chain contract, including: -->
<!-- - New or changed entry points -->
<!-- - New or changed error codes -->
<!-- - New or changed events -->
<!-- - Version constant update (CONTRACT_VERSION in storage.rs) -->
<!-- - Whether a new contract deployment is required -->

**Contract version:** X.Y.Z
**Deployment required:** Yes / No
**Migration required:** Yes / No — [link to migration guide if yes]

### Frontend

<!-- List any changes to the Next.js frontend, including: -->
<!-- - New or changed components -->
<!-- - New or changed env vars -->
<!-- - New or changed dependencies -->

**npm package version:** X.Y.Z

### Deploy / CI

<!-- List any changes to deploy/deploy.sh, Makefile, or CI workflows -->

---

[X.Y.Z]: https://github.com/Chrisland58/SorobanPay/compare/vPREV...vX.Y.Z
```

**Fill in all sections.** Remove any empty section rather than leaving a lone `-` bullet.

---

## 5. Step-by-Step Release Checklist

### Pre-release (on your branch)

- [ ] All PR entries are in `## [Unreleased]` in `CHANGELOG.md`.
- [ ] Version constants updated:
  - `contracts/subscription/src/storage.rs` — `CONTRACT_VERSION`, `VERSION_MAJOR/MINOR/PATCH`
  - `frontend/package.json` — `"version"` field
- [ ] `make build` passes cleanly.
- [ ] `make test` passes — all tests green.
- [ ] `cd frontend && npm run type-check` passes.
- [ ] `cd frontend && npm run lint` passes.
- [ ] `cd contracts/subscription && cargo audit` — no unfixed advisories.
- [ ] `cd frontend && npm audit --audit-level=high` — no unfixed high/critical.
- [ ] Contract deployed to **Testnet** and end-to-end flow manually verified.

### Changelog

- [ ] Promote `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` using the [Release Note Template](#4-release-note-template).
- [ ] Add a fresh empty `## [Unreleased]` section above the new versioned section.
- [ ] Add a compare URL at the bottom of `CHANGELOG.md`:
  ```
  [X.Y.Z]: https://github.com/Chrisland58/SorobanPay/compare/vPREV...vX.Y.Z
  ```
- [ ] Update the `[Unreleased]` compare URL:
  ```
  [Unreleased]: https://github.com/Chrisland58/SorobanPay/compare/vX.Y.Z...HEAD
  ```

### Commit and tag

```bash
git add CHANGELOG.md contracts/subscription/src/storage.rs frontend/package.json
git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main --follow-tags
```

### GitHub Release

1. Go to **Releases → Draft a new release**.
2. Select the tag `vX.Y.Z`.
3. Title: `vX.Y.Z — <release theme>` (keep under 70 chars).
4. Body: paste the versioned section from `CHANGELOG.md` verbatim.
5. Attach the compiled WASM:
   ```bash
   make build
   # Artifact: contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm
   ```
6. Check **Set as the latest release** (or **pre-release** for release candidates).
7. Publish.

### Post-release (if contract changed)

- [ ] Deploy new contract to **Mainnet** using `deploy/deploy.sh`.
- [ ] Update `NEXT_PUBLIC_CONTRACT_ID` in frontend production environment.
- [ ] Redeploy frontend.
- [ ] Notify merchants and integrators of the new contract address via Discord/email.
- [ ] Update `docs/deployment.md` if any deployment steps changed.

---

## 6. Component-Specific Notes

### Smart contract releases

Because Soroban contracts are immutable after deployment, any contract change requires a **new contract address**. Subscribers and merchants must be migrated to the new address — there is no in-place upgrade path. Before releasing a contract change:

1. Document the migration path in `docs/versioning.md`.
2. Plan a migration window: old contract remains accessible while subscribers re-subscribe.
3. Bump `VERSION_MAJOR` for breaking changes (entry point signature changes, event schema changes, error code reassignments).
4. Bump `VERSION_MINOR` for new entry points or new events.
5. Bump `VERSION_PATCH` for internal fixes that do not affect the ABI.

See [docs/versioning.md](versioning.md) for the full versioning and upgrade strategy.

### Frontend releases

Frontend releases do not require a contract redeployment unless the contract ABI changed. Update `frontend/package.json` version and rebuild/redeploy. Ensure `NEXT_PUBLIC_CONTRACT_ID` in the production environment matches the intended contract.

### Deployment script / CI releases

Changes to `deploy/deploy.sh` or CI workflows are released as `PATCH` or `MINOR` bumps in the overall project version. Document any new or changed environment variables in `docs/deployment.md`.

---

## 7. After Release

- [ ] Close the GitHub milestone for this version.
- [ ] Open a new milestone for the next version.
- [ ] Post a release announcement to Discord / social channels if applicable.
- [ ] Mark any issues resolved by this release as closed with the release tag.
- [ ] Review and triage any issues opened since the last release.
