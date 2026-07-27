CONTRACT_DIR := contracts/subscription
TARGET_DIR   := contracts/target
WASM_PATH    := $(TARGET_DIR)/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

# Supported triple → environment variables used by build/test recipes
TARGET_TRIPLE ?= wasm32-unknown-unknown
PROFILE       ?= release
ARTIFACT_NAME ?= soroban_subscription_contract
ARTIFACT_PATH  = $(TARGET_DIR)/$(TARGET_TRIPLE)/$(PROFILE)/$(ARTIFACT_NAME).wasm

CARGO_FLAGS   = --manifest-path $(CONTRACT_DIR)/Cargo.toml --target $(TARGET_TRIPLE) --$(PROFILE)

.PHONY: build test test-upgrade mutation-test clean

# build: Compile the contract to WASM using the current $(TARGET_TRIPLE) and $(PROFILE)
# Override at the command line, e.g.:
#   make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release
# Add new triple:
#   1) rustup target add <triple>
#   2) make build TARGET_TRIPLE=<triple>
build:
	cargo build $(CARGO_FLAGS)
	@test -f "$(ARTIFACT_PATH)" || \
		(echo "ERROR: WASM artifact not found at $(ARTIFACT_PATH)" >&2; exit 1)

# test: Run cargo tests for the contract (native host test, not WASM)
# Note: cargo test cannot cross-compile to WASM; keep this target native.
test:
	cargo test --manifest-path $(CONTRACT_DIR)/Cargo.toml

# test-upgrade: Run contract upgrade regression tests (TEST-103)
# Requires the `upgrade-test` feature flag.
test-upgrade:
	cargo test --manifest-path $(CONTRACT_DIR)/Cargo.toml \
	           --features upgrade-test \
	           -- upgrade

# mutation-test: Run cargo-mutants against the contract source (TEST-106)
# Requires: cargo install cargo-mutants
# Outputs a summary to stdout; full report in mutants.out/
# After running, generate the markdown report:
#   make mutation-report
mutation-test:
	cargo mutants --manifest-path $(CONTRACT_DIR)/Cargo.toml \
	              --output mutants.out \
	              -- --all-features

# mutation-report: Copy the last mutation run results into docs/mutation-report.md
mutation-report: mutation-test
	@mkdir -p docs
	@echo "# Mutation Testing Report" > docs/mutation-report.md
	@echo "" >> docs/mutation-report.md
	@echo "Generated: $$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> docs/mutation-report.md
	@echo "" >> docs/mutation-report.md
	@cat mutants.out/caught.txt >> docs/mutation-report.md 2>/dev/null || true
	@cat mutants.out/missed.txt >> docs/mutation-report.md 2>/dev/null || true

# clean: Remove all build artifacts for the contract
clean:
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml
	@rm -rf mutants.out
