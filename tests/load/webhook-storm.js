/**
 * k6 Load Test — Scenario 3: Webhook Storm
 * Issue: TEST-102
 *
 * Simulates 50 Virtual Users hammering webhook delivery acknowledgment endpoints
 * concurrently to stress-test the webhook delivery queue and DB write path.
 *
 * Models the situation where many merchants acknowledge webhook deliveries
 * simultaneously after a batch payment run — e.g., end-of-billing-cycle
 * execute_payment_batch triggering N webhook notifications at once.
 *
 * Performance targets (k6 thresholds):
 *   - p95 response time < 200ms
 *   - Zero 5xx errors under normal load
 *
 * Usage:
 *   k6 run --out json=results/webhook-storm-results.json tests/load/webhook-storm.js
 *
 * Environment variables:
 *   BASE_URL          backend base URL (default: http://localhost:3001)
 *   MERCHANT_ADDRESS  merchant address in staging DB
 *   NUM_MERCHANTS     number of distinct merchant addresses to simulate (default: 10)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const BASE_MERCHANT = __ENV.MERCHANT_ADDRESS || "GMERCHANT";
const NUM_MERCHANTS = parseInt(__ENV.NUM_MERCHANTS || "10", 10);

// ─── Custom metrics ───────────────────────────────────────────────────────────

const webhookRegisterDuration  = new Trend("webhook_register_duration_ms");
const webhookDeliveriesDuration = new Trend("webhook_deliveries_duration_ms");
const errorRate                = new Rate("error_rate");
const webhookRegistrations     = new Counter("webhook_registrations_total");
const webhookQueries           = new Counter("webhook_queries_total");

// ─── Test options & thresholds ────────────────────────────────────────────────

export const options = {
  scenarios: {
    webhook_storm: {
      executor: "constant-vus",
      vus: 50,
      duration: "2m",
      gracefulStop: "15s",
    },
  },
  thresholds: {
    http_req_duration:              ["p(95)<200"],
    webhook_register_duration_ms:   ["p(95)<200"],
    webhook_deliveries_duration_ms: ["p(95)<200"],
    http_req_failed:                ["rate<0.01"],
    error_rate:                     ["rate<0.01"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a deterministic merchant address from a VU index.
 * Pads to a valid-looking Stellar G-address length for realistic routing.
 */
function merchantForVU(vuIndex) {
  const idx = (vuIndex % NUM_MERCHANTS) + 1;
  return `${BASE_MERCHANT}${String(idx).padStart(
    55 - BASE_MERCHANT.length,
    "0"
  )}`;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(
      `Health check failed (${res.status}). Is the backend running at ${BASE_URL}?`
    );
  }
  return { baseUrl: BASE_URL };
}

// ─── Main VU loop ─────────────────────────────────────────────────────────────

export default function (data) {
  const { baseUrl } = data;
  const merchant = merchantForVU(__VU);
  const webhookUrl = `https://webhook-receiver.example.com/merchant/${__VU}/events`;

  // ── Step 1: Register / upsert webhook endpoint ────────────────────────────
  {
    const start = Date.now();
    const res = http.post(
      `${baseUrl}/api/webhooks/endpoints`,
      JSON.stringify({ merchant, url: webhookUrl }),
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    webhookRegisterDuration.add(Date.now() - start);
    webhookRegistrations.add(1);

    const ok = check(res, {
      "webhook register: status 2xx": (r) =>
        r.status >= 200 && r.status < 300,
      "webhook register: no 5xx": (r) => r.status < 500,
      "webhook register: < 500ms": (r) => r.timings.duration < 500,
    });
    errorRate.add(!ok || res.status >= 500);
  }

  sleep(0.02);

  // ── Step 2: Fetch recent delivery log (simulate acknowledgment check) ─────
  {
    const start = Date.now();
    const res = http.get(
      `${baseUrl}/api/webhooks/deliveries/${merchant}`,
      { headers: { Accept: "application/json" } }
    );
    webhookDeliveriesDuration.add(Date.now() - start);
    webhookQueries.add(1);

    const ok = check(res, {
      "webhook deliveries: status 200": (r) => r.status === 200,
      "webhook deliveries: body is array": (r) => {
        try {
          return Array.isArray(JSON.parse(r.body));
        } catch {
          return false;
        }
      },
      "webhook deliveries: no 5xx": (r) => r.status < 500,
      "webhook deliveries: < 500ms": (r) => r.timings.duration < 500,
    });
    errorRate.add(!ok || res.status >= 500);
  }

  sleep(0.02);

  // ── Step 3: Deactivate then re-register (models acknowledgment cycle) ─────
  if (__ITER % 5 === 0) {
    // Every 5th iteration, simulate a webhook deactivation
    const delRes = http.del(
      `${baseUrl}/api/webhooks/endpoints`,
      JSON.stringify({ merchant, url: webhookUrl }),
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );
    check(delRes, {
      "webhook deactivate: status 2xx": (r) =>
        r.status >= 200 && r.status < 300,
      "webhook deactivate: no 5xx": (r) => r.status < 500,
    });
    errorRate.add(delRes.status >= 500);
  }

  // Brief pause to avoid thundering-herd at exactly the same millisecond
  sleep(0.05 + Math.random() * 0.05);
}

export function teardown(data) {
  console.log(`Webhook storm scenario complete. Base URL: ${data.baseUrl}`);
}
