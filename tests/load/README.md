# Load Testing — TEST-102

k6 load tests for the SorobanPay backend API. These tests establish performance
baselines, verify SLA targets, and catch regressions in API throughput before
production releases.

## Scenarios

| File | VUs | Duration | Traffic pattern |
|------|-----|----------|----------------|
| `read-heavy.js` | 100 | 2 min | 100% GET /api/subscriptions reads |
| `mixed.js` | 50 | 2.5 min (ramp) | 70% reads, 20% payment queries, 10% webhook auth flows |
| `webhook-storm.js` | 50 | 2 min | 100% webhook register + delivery queries |

## Performance Targets

All scenarios enforce the following k6 thresholds — tests fail if any target is
missed:

| Metric | Target |
|--------|--------|
| p95 response time (GET endpoints) | < 200ms |
| Throughput (cached reads) | > 500 req/s |
| HTTP 5xx rate | 0% (< 1%) |
| Error rate (custom metric) | < 1% |

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) ≥ 0.50
- Docker + Docker Compose (for the staging environment)
- Node.js ≥ 18 (backend)

Install k6:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Docker
docker pull grafana/k6
```

## Running Locally

### 1. Start the staging backend

```bash
# From the project root
docker compose -f tests/load/docker-compose.staging.yml up -d

# Wait for the backend to be healthy
docker compose -f tests/load/docker-compose.staging.yml ps
```

The backend will be available at `http://localhost:3001`.

### 2. Run an individual scenario

```bash
# Read-heavy scenario
k6 run tests/load/read-heavy.js

# Mixed scenario
k6 run tests/load/mixed.js

# Webhook storm
k6 run tests/load/webhook-storm.js
```

### 3. Run all scenarios (via Makefile)

```bash
make load-test
```

### 4. Run with custom options

```bash
# Override backend URL and merchant address
k6 run \
  -e BASE_URL=http://localhost:3001 \
  -e MERCHANT_ADDRESS=GMERCHANT0000000000000000000000000000000000000000000001 \
  tests/load/read-heavy.js

# Run against a staging environment
k6 run \
  -e BASE_URL=https://api-staging.sorobanpay.example.com \
  -e MERCHANT_ADDRESS=<real-merchant-address> \
  tests/load/read-heavy.js
```

### 5. Export results as JSON (for CI artifact upload)

```bash
mkdir -p results
k6 run --out json=results/read-heavy-results.json tests/load/read-heavy.js
k6 run --out json=results/mixed-results.json       tests/load/mixed.js
k6 run --out json=results/webhook-storm-results.json tests/load/webhook-storm.js
```

### 6. Generate an HTML report

k6 does not bundle an HTML reporter natively. Use the community k6-reporter:

```bash
npm install -g k6-html-reporter
k6 run --out json=results/read-heavy-results.json tests/load/read-heavy.js
k6-html-reporter --output results/read-heavy-results.json
```

The CI workflow uploads the JSON results as artifacts automatically.

### 7. Tear down staging

```bash
docker compose -f tests/load/docker-compose.staging.yml down -v
```

## CI Integration

Load tests run weekly (Sundays at 02:30 UTC) and on `workflow_dispatch` in CI.
They require a staging environment — secrets are configured in the repository's
Actions settings:

| Secret | Description |
|--------|-------------|
| `LOAD_TEST_BASE_URL` | Staging backend URL |
| `LOAD_TEST_MERCHANT_ADDRESS` | Seeded merchant address |

Results (JSON + HTML) are uploaded as CI artifacts named `load-test-results`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3001` | Backend base URL |
| `MERCHANT_ADDRESS` | Placeholder G-address | Merchant address in the staging DB |
| `SUBSCRIBER_ADDRESS` | Placeholder G-address | Subscriber address (mixed scenario) |
| `NUM_MERCHANTS` | `10` | Number of distinct merchants to simulate (webhook storm) |

## Interpreting Results

k6 prints a summary table at the end of each run. Key metrics to watch:

- `http_req_duration` — p50/p95/p99 response times. p95 must be < 200ms.
- `http_req_failed` — rate of failed HTTP requests (network errors + 5xx).
- `iterations` — total number of VU loop completions.
- `http_reqs` — total requests sent; divide by duration for req/s.
- Custom trend metrics (`subscription_query_duration_ms`, etc.) provide
  per-endpoint breakdowns.

### Example passing output

```
✓ http_req_duration............: avg=45ms  min=12ms  med=38ms  max=210ms  p(90)=89ms  p(95)=112ms
✓ http_req_failed..............: 0.00%   ✓ 0       ✗ 0
✓ error_rate...................: 0.00%   ✓ 0       ✗ 0
```

### Common failure modes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| p95 > 200ms | Missing DB index or cache miss | Add index on `merchant` + `type` columns |
| 5xx errors | DB connection pool exhaustion | Increase `connection_limit` in `DATABASE_URL` |
| Throughput < 500 req/s | No Redis caching | Enable and configure Redis layer |
| Webhook storm timeouts | Sequential writes not batched | Batch webhook inserts with `createMany` |
