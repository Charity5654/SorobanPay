# ---------------------------------------------------------------------------
# SorobanPay — Makefile
#
# Common targets:
#   make help             Print this message
#   make build            Compile contract to WASM
#   make test             Run contract unit/property tests
#   make lint             Check formatting and run Clippy
#   make coverage         Run tests with llvm-cov and enforce threshold
#   make clean            Remove build artifacts
#   make test-frontend    Run the Next.js Jest test suite
#
# Override variables (safe to pass on the command line):
#
#   TARGET_TRIPLE   Rust compilation target fed to --target.
#                   Default: wasm32-unknown-unknown
#                   Example: make build TARGET_TRIPLE=x86_64-unknown-linux-gnu
#
#   PROFILE         Cargo profile name fed to --<profile>.
#                   Default: release
#                   Example: make build PROFILE=debug
#
#   COVERAGE_THRESHOLD
#                   Minimum required line-coverage percentage (0–100).
#                   Default: 95  (set per issue #432)
# ---------------------------------------------------------------------------

FRONTEND_DIR := frontend
CONTRACT_DIR := contracts/subscription
TARGET_DIR   := contracts/target
WASM_PATH    := $(TARGET_DIR)/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

# TARGET_TRIPLE — Rust cross-compilation target (override with TARGET_TRIPLE=<triple>)
TARGET_TRIPLE ?= wasm32-unknown-unknown

# PROFILE — Cargo build/test profile (override with PROFILE=<debug|release>)
PROFILE       ?= release

ARTIFACT_NAME ?= soroban_subscription_contract
ARTIFACT_PATH  = $(TARGET_DIR)/$(TARGET_TRIPLE)/$(PROFILE)/$(ARTIFACT_NAME).wasm

CARGO_FLAGS   = --manifest-path $(CONTRACT_DIR)/Cargo.toml --target $(TARGET_TRIPLE) --$(PROFILE)

# COVERAGE_THRESHOLD — minimum line-coverage % enforced by make coverage (issue #432)
COVERAGE_THRESHOLD ?= 95

.PHONY: help build test lint test-coverage coverage clean test-frontend test-frontend-coverage

help: ## Print all available targets with descriptions
	@echo ""
	@echo "SorobanPay — available make targets"
	@echo "------------------------------------"
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ { printf "  %-26s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@echo ""
	@echo "Override variables:"
	@echo "  TARGET_TRIPLE=<triple>   Rust compilation target  (default: wasm32-unknown-unknown)"
	@echo "  PROFILE=<debug|release>  Cargo profile            (default: release)"
	@echo "  COVERAGE_THRESHOLD=<n>   Min line-coverage %%      (default: 95)"
	@echo ""

build: ## Compile the contract to WASM (uses TARGET_TRIPLE and PROFILE)
	cargo build $(CARGO_FLAGS)
	@test -f "$(ARTIFACT_PATH)" || \
		(echo "ERROR: WASM artifact not found at $(ARTIFACT_PATH)" >&2; exit 1)

# Note: cargo test cannot execute WASM binaries; never set TARGET_TRIPLE here.
test: ## Run contract unit and property tests on the native host (not WASM)
	cargo test --manifest-path $(CONTRACT_DIR)/Cargo.toml

# Requires: rustfmt and clippy components (rustup component add rustfmt clippy)
lint: ## Check formatting (rustfmt --check) and run Clippy on the contract
	cargo fmt --manifest-path $(CONTRACT_DIR)/Cargo.toml -- --check
	cargo clippy --manifest-path $(CONTRACT_DIR)/Cargo.toml --all-targets -- -D warnings

test-coverage: coverage ## Alias for coverage

# Generates:
#   contracts/target/lcov.info          — LCOV data for Codecov / CI badge
#   contracts/target/coverage-html/     — Human-readable HTML report
#
# Requires: cargo install cargo-llvm-cov
coverage: ## Run contract tests with llvm-cov; enforce COVERAGE_THRESHOLD
	@echo "Running contract tests with coverage instrumentation…"
	cargo llvm-cov \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml \
		--lcov --output-path $(TARGET_DIR)/lcov.info
	cargo llvm-cov \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml \
		--html --output-dir $(TARGET_DIR)/coverage-html
	@echo ""
	@echo "Coverage report: $(TARGET_DIR)/coverage-html/index.html"
	@echo "LCOV data:       $(TARGET_DIR)/lcov.info"
	@echo ""
	@$(MAKE) _check-coverage-threshold

# Internal target: parse lcov.info and enforce the threshold.
# Separated so CI can also call it after uploading reports.
_check-coverage-threshold:
	@LCOV_FILE="$(TARGET_DIR)/lcov.info"; \
	if [ ! -f "$$LCOV_FILE" ]; then \
		echo "ERROR: $$LCOV_FILE not found. Run 'make coverage' first." >&2; \
		exit 1; \
	fi; \
	FOUND=$$(grep -E "^LF:" "$$LCOV_FILE" | awk -F: '{sum += $$2} END {print sum}'); \
	HIT=$$(grep  -E "^LH:" "$$LCOV_FILE" | awk -F: '{sum += $$2} END {print sum}'); \
	if [ -z "$$FOUND" ] || [ "$$FOUND" -eq 0 ]; then \
		echo "ERROR: No coverage data in $$LCOV_FILE" >&2; \
		exit 1; \
	fi; \
	PCT=$$(echo "scale=2; $$HIT * 100 / $$FOUND" | bc); \
	echo "Line coverage: $${PCT}% ($${HIT}/$${FOUND} lines)"; \
	PASS=$$(echo "$$PCT" | awk '{print ($$1 >= $(COVERAGE_THRESHOLD)) ? "yes" : "no"}'); \
	if [ "$$PASS" != "yes" ]; then \
		echo "FAIL: $${PCT}% is below the required $(COVERAGE_THRESHOLD)% threshold." >&2; \
		exit 1; \
	fi; \
	echo "PASS: $${PCT}% meets the $(COVERAGE_THRESHOLD)% threshold."

clean: ## Remove all contract build artifacts from contracts/target/
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml

test-frontend: ## Run the Next.js Jest test suite (unit + coverage)
	cd $(FRONTEND_DIR) && npm run test

test-frontend-coverage: ## Run the Next.js Jest suite with coverage report
	cd $(FRONTEND_DIR) && npm run test:coverage
