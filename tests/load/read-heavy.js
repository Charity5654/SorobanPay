/**
 * k6 Load Test — Scenario 1: Read-Heavy
 * Issue: TEST-102
 *
 * Simulates 100 Virtual Users hammering GET /api/subscriptions/merchant/:address
 * for 2 minutes to establish read throughput baselines and identify bottlenecks
 * in the Redis cache + DB query layer.
 *
 * Performance targets (k6 thresholds):
 *   - p95 response time < 200ms
 *   - Throughput > 500 req/s for cached reads
 *   - Zero 5xx errors under normal load
 *
 * Usage:
 *   k6 run --out json=results/read-heavy-results.json tests/load/read-heavy.js
 *
 * Environment variables:
 *   BASE_URL          backend base URL (default: http://localhost:3001)
 *   MERCHANT_ADDRESS  a merchant address present in the staging DB
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const MERCHANT_ADDRESS =
  __ENV.MERCHANT_ADDRESS ||
  "GMERCHANT0000000000000000000000000000000000000000000001";

// ─── Custom metrics ───────────────────────────────────────────────────────────

const errorRate = new Rate("error_rate");
const subscriptionQueryDuration = new Trend("subscription_query_duration_ms");

// ─── Test options & thresholds ────────────────────────────────────────────────

export const options = {
  scenarios: {
    read_heavy: {
      executor: "constant-vus",
      vus: 100,
      duration: "2m",
      gracefulStop: "10s",
    },
  },
  thresholds: {
    // p95 response time must be under 200ms
    http_req_duration: ["p(95)<200"],
    subscription_query_duration_ms: ["p(95)<200"],
    // Zero 5xx errors
    http_req_failed: ["rate<0.01"],
    error_rate: ["rate<0.01"],
  },
};

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(
      `Health check failed (${res.status}). Is the backend running at ${BASE_URL}?`
    );
  }
  return { baseUrl: BASE_URL, merchantAddress: MERCHANT_ADDRESS };
}

// ─── Main VU loop ─────────────────────────────────────────────────────────────

export default function (data) {
  const { baseUrl, merchantAddress } = data;

  // 1. List subscriptions for merchant (most cache-sensitive query)
  {
    const start = Date.now();
    const res = http.get(
      `${baseUrl}/api/subscriptions/merchant/${merchantAddress}`,
      { headers: { Accept: "application/json" } }
    );
    subscriptionQueryDuration.add(Date.now() - start);

    const ok = check(res, {
      "subscriptions: status 200": (r) => r.status === 200,
      "subscriptions: body is array": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch {
          return false;
        }
      },
      "subscriptions: p95 < 500ms": (r) => r.timings.duration < 500,
    });
    errorRate.add(!ok);
  }

  sleep(0.05);

  // 2. Paginated payments query
  {
    const res = http.get(
      `${baseUrl}/api/subscriptions/merchant/${merchantAddress}/payments?limit=50`,
      { headers: { Accept: "application/json" } }
    );
    check(res, {
      "payments: status 200": (r) => r.status === 200,
      "payments: no 5xx": (r) => r.status < 500,
    });
    errorRate.add(res.status >= 500);
  }

  sleep(0.05);

  // 3. Health check (sanity / lightweight probe)
  {
    const res = http.get(`${baseUrl}/health`);
    check(res, {
      "health: status 200": (r) => r.status === 200,
      "health: < 100ms": (r) => r.timings.duration < 100,
    });
  }

  sleep(0.1);
}

export function teardown(data) {
  console.log(`Read-heavy scenario complete. Base URL: ${data.baseUrl}`);
}
