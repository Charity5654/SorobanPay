# Release Process

This document describes how to cut a SorobanPay release: versioning conventions,
changelog hygiene, release note template, and the step-by-step checklist.

---

## Table of Contents

1. [Versioning](#1-versioning)
2. [Changelog Hygiene](#2-changelog-hygiene)
3. [Release Note Template](#3-release-note-template)
4. [Step-by-Step Release Checklist](#4-step-by-step-release-checklist)
5. [Component-Specific Notes](#5-component-specific-notes)
6. [After Release](#6-after-release)

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

## 2. Changelog Hygiene

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

## 3. Release Note Template

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

## 4. Step-by-Step Release Checklist

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

- [ ] Promote `## [Unreleased]` to `## [X.Y.Z] — YYYY-MM-DD` using the [Release Note Template](#3-release-note-template).
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

## 5. Component-Specific Notes

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

## 6. After Release

- [ ] Close the GitHub milestone for this version.
- [ ] Open a new milestone for the next version.
- [ ] Post a release announcement to Discord / social channels if applicable.
- [ ] Mark any issues resolved by this release as closed with the release tag.
- [ ] Review and triage any issues opened since the last release.
