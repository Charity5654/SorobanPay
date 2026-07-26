# Contributing to SorobanPay

Thank you for your interest in contributing! This guide covers development setup (including Windows/WSL2), code conventions, commit format, testing requirements, the PR process, issue triage, and security disclosure.

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Development Setup](#2-development-setup)
3. [Code Conventions](#3-code-conventions)
4. [Testing Requirements](#4-testing-requirements)
5. [PR Process](#5-pr-process)
6. [Issue Triage Guide](#6-issue-triage-guide)
7. [Security Vulnerability Reporting](#7-security-vulnerability-reporting)
8. [Labels Reference](#8-labels-reference)

---

## 1. Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to its terms. Report unacceptable behaviour via GitHub Security Advisories (private) or by messaging a maintainer directly.

---

## 2. Development Setup

### macOS / Linux

**Prerequisites:**

| Tool | Min version | Install |
|------|------------|---------|
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | `cargo install --locked stellar-cli --features opt` |
| Node.js | ≥ 18.x | https://nodejs.org or `nvm install --lts` |
| PostgreSQL | ≥ 14 | `brew install postgresql@16` / `apt install postgresql` |

**Clone and build:**

```bash
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay

# Smart contract
make build
make test

# Backend
cd backend
cp .env.example .env          # fill in DATABASE_URL, RPC_URL, CONTRACT_ID
npm install
npx prisma migrate dev --name init

# Frontend
cd ../frontend
cp .env.example .env.local    # fill in NEXT_PUBLIC_CONTRACT_ID
npm install
npm run dev
```

**Verify everything works:**

```bash
make test                          # contract tests pass
cd frontend && npm run type-check  # frontend TypeScript clean
cd backend  && npx tsc --noEmit    # backend TypeScript clean
```

### Windows (WSL2)

WSL2 is the recommended environment for Windows contributors. Native Windows is not supported.

**Step 1 — Enable WSL2** (PowerShell as Administrator):

```powershell
wsl --install
# Restart when prompted, then open "Ubuntu" from the Start menu
```

**Step 2 — Install dependencies inside WSL2:**

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential pkg-config libssl-dev

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown

# Stellar CLI
cargo install --locked stellar-cli --features opt

# Node.js via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install --lts

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER soroban WITH PASSWORD 'soroban'; CREATE DATABASE sorobanpay OWNER soroban;"
```

**Step 3 — Clone inside the WSL2 filesystem** (not `/mnt/c/`) for best performance:

```bash
cd ~
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay
```

Install the [WSL VS Code extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) and open with `code .` from the WSL terminal.

**Common WSL2 issues:**

| Symptom | Fix |
|---------|-----|
| `cargo: command not found` | `source "$HOME/.cargo/env"` or restart terminal |
| PostgreSQL not starting | `sudo service postgresql start` |
| Port not accessible in Windows browser | WSL2 forwards ports automatically — open `http://localhost:3000` |
| Slow file I/O | Always clone to `~/`, never `/mnt/c/` |

---

## 3. Code Conventions

### Rust (smart contract)

Format and lint before every commit:

```bash
cd contracts/subscription
cargo fmt
cargo clippy -- -D warnings
```

Style rules:
- Call `require_auth()` as the **first statement** in every entry point — before any storage reads, logging, or cross-contract calls.
- Return `Result<(), ContractError>` from all fallible entry points.
- Emit events **after** all state mutations succeed, never before.
- Add `///` rustdoc comments to every public item. See `contracts/subscription/src/lib.rs` for the established doc style.
- Keep helper functions private (`fn`) unless they are part of the public contract API.

### TypeScript (frontend + backend)

```bash
# Frontend
cd frontend && npm run lint && npm run type-check

# Backend
cd backend && npx tsc --noEmit
```

Style rules:
- Prefer `const` over `let`; never use `var`.
- Explicit return types on all exported functions.
- Parse external data (RPC responses, env vars) with type guards — avoid unchecked `as` casts.
- Never log secrets (DB URLs, private keys, webhook secrets).
- Async functions must return `Promise`; do not mix callbacks and promises.

### Commit messages — Conventional Commits

All commits must follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>[optional scope]: <short description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type | When |
|------|------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Tests only |
| `refactor` | Neither fix nor feature |
| `chore` | Dependencies, build, CI |
| `perf` | Performance improvement |
| `ci` | CI/CD config changes |
| `revert` | Reverts a previous commit |

**Examples:**

```
feat(contract): add execute_payment_batch entry point
fix(frontend): prevent double-submission on slow Freighter response
docs: add CONTRIBUTING.md and CODE_OF_CONDUCT.md
test(backend): cover reconciler duplicate-event handling
chore: bump soroban-sdk to 22.0.0
```

**Breaking changes** — use `!` or a `BREAKING CHANGE:` footer:

```
feat(contract)!: remove is_paused from SubscriptionData

BREAKING CHANGE: Off-chain decoders must drop the is_paused field.
```

---

## 4. Testing Requirements

### Smart contract

```bash
cd contracts/subscription && cargo test
```

The suite covers lifecycle, all error paths, authorization, time-lock, events, and property tests.

Rules:
- Every new `ContractError` variant must have at least one test that triggers it.
- Every new entry point must have: happy path, auth failure, and the most common error path.
- Tests live in `contracts/subscription/src/test.rs`.

### Frontend

```bash
cd frontend
npm test              # Jest unit tests
npm run type-check    # TypeScript strict mode
npx playwright test   # E2E (required for UI-affecting changes)
```

Rule: New React components need at least one Jest test covering the primary render path and interactive states.

### Backend

```bash
cd backend && npm test
```

Rules:
- New service methods need unit tests with mocked Prisma and RPC clients.
- New API routes need integration tests in `backend/tests/`.
- Retry logic tests must cover both success-after-retry and exhausted-retries paths.

### CI gates (all must pass before merge)

1. `cargo fmt -- --check`
2. `cargo clippy -- -D warnings`
3. `cargo test`
4. `cargo audit`
5. Frontend: `lint`, `type-check`, `test`, `npm audit --audit-level=high`
6. Backend: `tsc --noEmit`, `test`, `npm audit --audit-level=high`

---

## 5. PR Process

### Branch naming

```
fix/<issue-number>-<short-description>
feat/<issue-number>-<short-description>
docs/<issue-number>-<short-description>
chore/<description>
```

### Opening a PR

1. Branch from `main`:
   ```bash
   git checkout main && git pull origin main
   git checkout -b feat/201-add-get-subscription
   ```
2. Commit using Conventional Commits.
3. Run CI checks locally (see [Testing Requirements](#4-testing-requirements)).
4. Push and open a PR:
   ```bash
   git push -u origin feat/201-add-get-subscription
   ```

### PR description template

```markdown
## Summary
<!-- 1–3 sentences: what does this PR do and why? -->

## Related issue
Closes #<number>

## Changes
-
-

## Testing
<!-- Tests added/updated, how you verified -->

## Breaking changes
<!-- List them, or "None" -->

## Checklist
- [ ] Tests added or updated
- [ ] `make test` passes (contract)
- [ ] `npm run type-check` passes (frontend)
- [ ] Conventional commits used
- [ ] Documentation updated where applicable
```

### Review requirements

- **1 approving review** required for all PRs.
- **2 approving reviews** required for any change to `contracts/subscription/src/`.
- Reviewers check: `require_auth` placement, event emission order, error handling completeness, test coverage, no secrets in diff.
- Address all review comments before requesting re-review.
- Squash merge for features/fixes; merge commit for release branches.
- Delete your branch after merge.

---

## 6. Issue Triage Guide

For maintainers and trusted contributors.

1. Read and understand the issue — ask for clarification before labelling.
2. Search for duplicates before accepting.
3. Assign labels (see [Labels Reference](#8-labels-reference)).
4. Set priority:
   - `P0` — blocks production or poses security risk; address immediately
   - `P1` — significant user-facing regression; next release
   - `P2` — meaningful improvement; schedule when capacity allows
   - `P3` — nice-to-have; backlog
5. Assign a milestone if targeting a specific version.
6. Reproduce bugs before confirming.
7. Close stale issues (90 days no activity) with a 14-day notice comment.

---

## 7. Security Vulnerability Reporting

**Do not open a public GitHub issue for security vulnerabilities.**

Use **GitHub Security Advisories**:

1. Repository → **Security** → **Advisories** → **New draft security advisory**.
2. Include: affected component, description, reproduction steps, impact, and suggested mitigations.
3. Submit — it is private and visible only to you and the maintainers.

You will receive acknowledgement within **72 hours**. We coordinate disclosure within **90 days** of the initial report (shorter for critical issues). Responsible disclosers are credited in release notes.

Full policy: [docs/security.md](docs/security.md#8-security-disclosure-policy).

---

## 8. Labels Reference

| Label | Purpose |
|-------|---------|
| `bug` | Confirmed unintended behaviour |
| `enhancement` | New feature or improvement |
| `documentation` | Docs or comment updates |
| `test` | Test coverage improvements |
| `contract` | Changes to `contracts/subscription/src/` |
| `frontend` | Changes to the Next.js frontend |
| `backend` | Changes to the Express backend or cron jobs |
| `deployment` | Build, deploy, or CI changes |
| `security` | Security-related (sensitive issues → GitHub Advisories) |
| `duplicate` | Covered by an existing issue |
| `wontfix` | Out of scope or intentional design |
| `good first issue` | Small, well-bounded; newcomer-friendly |
| `help wanted` | Community contributions welcome |
| `P0` / `P1` / `P2` / `P3` | Priority levels |
