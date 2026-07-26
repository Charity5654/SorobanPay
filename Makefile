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

.PHONY: build test test-coverage clean

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

# test-coverage: Run contract tests with llvm-cov and emit lcov + HTML reports.
# Requires: cargo install cargo-llvm-cov
# Output:   contracts/target/lcov.info  and  contracts/target/coverage-html/
test-coverage:
	cargo llvm-cov \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml \
		--lcov --output-path $(TARGET_DIR)/lcov.info
	cargo llvm-cov \
		--manifest-path $(CONTRACT_DIR)/Cargo.toml \
		--html --output-dir $(TARGET_DIR)/coverage-html
	@echo "Coverage report: $(TARGET_DIR)/coverage-html/index.html"
	@echo "LCOV data:       $(TARGET_DIR)/lcov.info"

# clean: Remove all build artifacts for the contract
clean:
	cargo clean --manifest-path $(CONTRACT_DIR)/Cargo.toml

## test-frontend: Run the frontend Jest test suite (unit + load tests)
test-frontend:
	cd $(FRONTEND_DIR) && npm run test

## load-test: Run all k6 load test scenarios against the local staging stack.
## Requires: k6 installed (https://k6.io) and the staging backend running via
##   docker compose -f tests/load/docker-compose.staging.yml up -d
LOAD_TEST_DIR  := tests/load
LOAD_RESULTS   := results
BASE_URL       ?= http://localhost:3001
MERCHANT_ADDR  ?= GMERCHANT0000000000000000000000000000000000000000000001

.PHONY: load-test load-test-read load-test-mixed load-test-webhook load-test-staging-up load-test-staging-down

load-test-staging-up:
	docker compose -f $(LOAD_TEST_DIR)/docker-compose.staging.yml up -d
	@echo "Waiting for backend to become healthy..."
	@timeout 60 sh -c 'until docker compose -f $(LOAD_TEST_DIR)/docker-compose.staging.yml ps | grep backend | grep -q "healthy"; do sleep 2; done'
	@echo "Backend is ready."

load-test-staging-down:
	docker compose -f $(LOAD_TEST_DIR)/docker-compose.staging.yml down -v

load-test-read:
	@mkdir -p $(LOAD_RESULTS)
	k6 run \
	  -e BASE_URL=$(BASE_URL) \
	  -e MERCHANT_ADDRESS=$(MERCHANT_ADDR) \
	  --out json=$(LOAD_RESULTS)/read-heavy-results.json \
	  $(LOAD_TEST_DIR)/read-heavy.js

load-test-mixed:
	@mkdir -p $(LOAD_RESULTS)
	k6 run \
	  -e BASE_URL=$(BASE_URL) \
	  -e MERCHANT_ADDRESS=$(MERCHANT_ADDR) \
	  --out json=$(LOAD_RESULTS)/mixed-results.json \
	  $(LOAD_TEST_DIR)/mixed.js

load-test-webhook:
	@mkdir -p $(LOAD_RESULTS)
	k6 run \
	  -e BASE_URL=$(BASE_URL) \
	  -e MERCHANT_ADDRESS=$(MERCHANT_ADDR) \
	  --out json=$(LOAD_RESULTS)/webhook-storm-results.json \
	  $(LOAD_TEST_DIR)/webhook-storm.js

load-test: load-test-read load-test-mixed load-test-webhook
	@echo "All load test scenarios complete. Results in $(LOAD_RESULTS)/"
