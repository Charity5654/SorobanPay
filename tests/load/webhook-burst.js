/**
 * k6 Load Test — Scenario: Webhook Burst Load Test
 * Issue: #1136 (greatKhalifa-code)
 *
 * Models sudden, massive burst arrival of webhook events (e.g. following
 * an on-chain batch execution or ledger close with 100+ events simultaneously).
 *
 * Target:
 *   - Rapid ramp from 0 to 100 VUs in 10s
 *   - Sustained burst load for 30s
 *   - Verification of queue ingestion throughput, latency under burst, and error rate < 1%
 *
 * Usage:
 *   k6 run tests/load/webhook-burst.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const MERCHANT_PREFIX = __ENV.MERCHANT_PREFIX || "GMERCHANT_BURST";

const burstDispatchDuration = new Trend("webhook_burst_dispatch_ms");
const burstErrorRate        = new Rate("burst_error_rate");
const deliveredCount        = new Counter("burst_deliveries_total");

export const options = {
  scenarios: {
    webhook_burst: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 100 }, // Sudden sharp spike
        { duration: "30s", target: 100 }, // Hold high peak
        { duration: "10s", target: 10 },  // Cool down
        { duration: "5s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration:            ["p(95)<300", "p(99)<500"],
    webhook_burst_dispatch_ms:   ["p(95)<250"],
    burst_error_rate:             ["rate<0.01"],
  },
};

export default function () {
  const merchantId = `${MERCHANT_PREFIX}_${__VU % 20}`;
  const eventPayload = JSON.stringify({
    event: "payment.executed",
    subscriber: `GSUB_${__VU}_${__ITER}`,
    merchant: merchantId,
    amount: "25000000",
    txHash: `tx_${__VU}_${__ITER}_${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": `burst_${__VU}_${__ITER}`,
    },
  };

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/v1/webhooks/deliver`, eventPayload, params);
  burstDispatchDuration.add(Date.now() - start);

  const success = check(res, {
    "status is 200, 201, or 202": (r) => [200, 201, 202].includes(r.status),
    "response does not error": (r) => r.status < 500,
  });

  burstErrorRate.add(!success);
  if (success) {
    deliveredCount.add(1);
  }

  // Jittered short sleep between 50ms and 150ms to simulate tight burst concurrency
  sleep(0.05 + Math.random() * 0.1);
}
