/**
 * k6 Load Test — Scenario 2: Mixed Traffic
 * Issue: TEST-102
 *
 * Simulates realistic production traffic distribution:
 *   - 70% reads  — GET /api/subscriptions/merchant/:address
 *   - 20% payment queries — GET /api/subscriptions/merchant/:address/payments
 *   - 10% auth / webhook flows — POST + GET /api/webhooks/endpoints
 *
 * Exercises the full request mix to reveal contention between read and write
 * paths, connection-pool exhaustion, and DB-lock behaviour under concurrency.
 *
 * Performance targets (k6 thresholds):
 *   - p95 response time < 200ms for GET endpoints
 *   - Zero 5xx errors under normal load
 *
 * Usage:
 *   k6 run --out json=results/mixed-results.json tests/load/mixed.js
 *
 * Environment variables:
 *   BASE_URL          backend base URL (default: http://localhost:3001)
 *   MERCHANT_ADDRESS  a merchant address present in the staging DB
 *   SUBSCRIBER_ADDRESS  a subscriber address for payment queries
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const MERCHANT_ADDRESS =
  __ENV.MERCHANT_ADDRESS ||
  "GMERCHANT0000000000000000000000000000000000000000000001";
const SUBSCRIBER_ADDRESS =
  __ENV.SUBSCRIBER_ADDRESS ||
  "GSUBSCRIBER000000000000000000000000000000000000000000001";

// ─── Custom metrics ───────────────────────────────────────────────────────────

const readDuration    = new Trend("read_duration_ms");
const paymentDuration = new Trend("payment_query_duration_ms");
const authDuration    = new Trend("auth_flow_duration_ms");
const errorRate       = new Rate("error_rate");
const readCount       = new Counter("read_requests");
const paymentCount    = new Counter("payment_requests");
const authCount       = new Counter("auth_requests");

// ─── Test options & thresholds ────────────────────────────────────────────────

export const options = {
  scenarios: {
    mixed_traffic: {
      executor: "ramping-vus",
      startVUs: 10,
      stages: [
        { duration: "30s", target: 50 },   // ramp up
        { duration: "90s", target: 50 },   // sustained mixed load
        { duration: "30s", target: 0 },    // ramp down
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration:     ["p(95)<200"],
    read_duration_ms:      ["p(95)<200"],
    payment_query_duration_ms: ["p(95)<200"],
    http_req_failed:       ["rate<0.01"],
    error_rate:            ["rate<0.01"],
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
  return { baseUrl: BASE_URL, merchantAddress: MERCHANT_ADDRESS, subscriberAddress: SUBSCRIBER_ADDRESS };
}

// ─── Traffic distribution ─────────────────────────────────────────────────────

/**
 * Returns a value in [0, 1) — used to split traffic across request types.
 * Using Math.random() here is acceptable for load testing; not cryptographic.
 */
function randomWeight() {
  return Math.random();
}

// ─── Request handlers ─────────────────────────────────────────────────────────

function doRead(baseUrl, merchantAddress) {
  const start = Date.now();
  const res = http.get(
    `${baseUrl}/api/subscriptions/merchant/${merchantAddress}`,
    { headers: { Accept: "application/json" } }
  );
  readDuration.add(Date.now() - start);
  readCount.add(1);

  const ok = check(res, {
    "read: status 200": (r) => r.status === 200,
    "read: no 5xx":     (r) => r.status < 500,
    "read: < 500ms":    (r) => r.timings.duration < 500,
  });
  errorRate.add(!ok || res.status >= 500);
}

function doPaymentQuery(baseUrl, merchantAddress) {
  const start = Date.now();
  // Alternate between fetching with and without pagination to exercise both paths
  const limit = Math.random() > 0.5 ? 50 : 20;
  const offset = Math.floor(Math.random() * 5) * limit;
  const res = http.get(
    `${baseUrl}/api/subscriptions/merchant/${merchantAddress}/payments?limit=${limit}&offset=${offset}`,
    { headers: { Accept: "application/json" } }
  );
  paymentDuration.add(Date.now() - start);
  paymentCount.add(1);

  const ok = check(res, {
    "payment query: status 200": (r) => r.status === 200,
    "payment query: no 5xx":     (r) => r.status < 500,
    "payment query: < 500ms":    (r) => r.timings.duration < 500,
  });
  errorRate.add(!ok || res.status >= 500);
}

function doAuthFlow(baseUrl, merchantAddress) {
  const start = Date.now();
  const webhookUrl = `https://example.com/webhook/${__VU}`;

  // Register a webhook endpoint (write path)
  const postRes = http.post(
    `${baseUrl}/api/webhooks/endpoints`,
    JSON.stringify({ merchant: merchantAddress, url: webhookUrl }),
    { headers: { "Content-Type": "application/json", Accept: "application/json" } }
  );

  // Query recent webhook deliveries (read path following a write)
  const getRes = http.get(
    `${baseUrl}/api/webhooks/deliveries/${merchantAddress}`,
    { headers: { Accept: "application/json" } }
  );

  authDuration.add(Date.now() - start);
  authCount.add(1);

  const ok = check(postRes, {
    "webhook register: status 2xx": (r) => r.status >= 200 && r.status < 300,
    "webhook register: no 5xx":     (r) => r.status < 500,
  });
  check(getRes, {
    "webhook deliveries: status 200": (r) => r.status === 200,
    "webhook deliveries: no 5xx":     (r) => r.status < 500,
  });
  errorRate.add(!ok || postRes.status >= 500 || getRes.status >= 500);
}

// ─── Main VU loop ─────────────────────────────────────────────────────────────

export default function (data) {
  const { baseUrl, merchantAddress } = data;
  const weight = randomWeight();

  if (weight < 0.70) {
    // 70% — subscription list reads (cache-heavy path)
    doRead(baseUrl, merchantAddress);
  } else if (weight < 0.90) {
    // 20% — payment query (DB-heavy path)
    doPaymentQuery(baseUrl, merchantAddress);
  } else {
    // 10% — auth + webhook flow (write path)
    doAuthFlow(baseUrl, merchantAddress);
  }

  // Moderate think time to model real-world request pacing
  sleep(0.1 + Math.random() * 0.2);
}

export function teardown(data) {
  console.log(`Mixed-traffic scenario complete. Base URL: ${data.baseUrl}`);
}
