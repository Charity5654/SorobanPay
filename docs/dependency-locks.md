# Dependency Lockfiles

SorobanPay commits lockfiles for the root gas-estimation scripts, frontend, backend, and Rust contract. Pull requests run `npm ci --ignore-scripts` for each npm package and `cargo metadata --locked` for the contract. Cargo build, test, lint, and coverage entry points also use locked resolution. These checks need no deployment identity, wallet key, or repository secret.

## Updating dependencies

For an npm package, update its manifest and regenerate that directory's lockfile with `npm install --package-lock-only`; use Node 22 for the root package and Node 20 for frontend/backend. For the contract, use `cargo update` for a targeted dependency or `cargo generate-lockfile` for an intentional full refresh. Review the lockfile diff and commit it with the corresponding manifest change.

## Recovery

If an update is unintended or causes CI failures, revert the manifest and its lockfile together. The lock workflow is read-only and blocks mismatches; it does not deploy, publish artifacts, or modify the repository. Re-run the normal PR checks after restoring the previous pair.
