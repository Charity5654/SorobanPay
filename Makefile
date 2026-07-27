FRONTEND_DIR := frontend
CONTRACT_DIR := contracts/subscription
TARGET_DIR   := contracts/target
WASM_PATH    := $(TARGET_DIR)/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

# Supported triple → environment variables used by build/test recipes
TARGET_TRIPLE ?= wasm32-unknown-unknown
PROFILE       ?= release
ARTIFACT_NAME ?= soroban_subscription_contract
ARTIFACT_PATH  = $(TARGET_DIR)/$(TARGET_TRIPLE)/$(PROFILE)/$(ARTIFACT_NAME).wasm

CARGO_FLAGS   = --manifest-path $(CONTRACT_DIR)/Cargo.toml --target $(TARGET_TRIPLE) --$(PROFILE)

# Issue #432: Coverage threshold (95% line coverage required)
COVERAGE_THRESHOLD ?= 95

.PHONY: build test test-coverage coverage clean test-frontend

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

# test-coverage / coverage: Run contract tests with llvm-cov.
#
# Generates:
#   contracts/target/lcov.info          — LCOV data for Codecov / CI badge
#   contracts/target/coverage-html/     — Human-readable HTML report
#
# Then enforces the $(COVERAGE_THRESHOLD)% line-coverage threshold.
# Fails with a non-zero exit code if coverage is below the threshold.
#
# Requires: cargo install cargo-llvm-cov
test-coverage: coverage

coverage:
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

# clean: Remove all build artifacts for the contract
clean:
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml

# test-frontend: Run the frontend Jest test suite (unit + coverage)
test-frontend:
	cd $(FRONTEND_DIR) && npm run test

# test-frontend-coverage: Run the frontend Jest suite with coverage report
test-frontend-coverage:
	cd $(FRONTEND_DIR) && npm run test:coverage
