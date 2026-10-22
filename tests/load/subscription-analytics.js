/**
 * k6 Load Test — Subscription & Analytics Query Storm
 * Issue: TEST-1135
 *
 * Simulates high concurrent read load on subscription state endpoints
 * and analytics aggregation endpoints to establish latency baselines (p95 < 200ms)
 * and ensure zero 5xx server errors under heavy querying.
 *
 * Usage:
 *   k6 run tests/load/subscription-analytics.js
 */

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const MERCHANT_ADDRESS =
  __ENV.MERCHANT_ADDRESS || "GMERCHANT0000000000000000000000000000000000000000000001";

const errorRate = new Rate("error_rate");
const subscriptionLatency = new Trend("subscription_latency_ms");
const analyticsLatency = new Trend("analytics_latency_ms");

export const options = {
  scenarios: {
    subscription_analytics_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<250"],
    subscription_latency_ms: ["p(95)<200"],
    analytics_latency_ms: ["p(95)<250"],
    error_rate: ["rate<0.01"],
  },
};

export default function () {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  group("Subscriptions Read", () => {
    const subRes = http.get(
      `${BASE_URL}/api/subscriptions/merchant/${MERCHANT_ADDRESS}`,
      { headers }
    );
    subscriptionLatency.add(subRes.timings.duration);
    const success = check(subRes, {
      "subscription status 200 or 404": (r) => r.status === 200 || r.status === 404,
      "subscription response under 200ms": (r) => r.timings.duration < 200,
    });
    errorRate.add(!success);
  });

  group("Analytics Aggregation", () => {
    const analyticsRes = http.get(
      `${BASE_URL}/api/analytics/summary?merchant=${MERCHANT_ADDRESS}`,
      { headers }
    );
    analyticsLatency.add(analyticsRes.timings.duration);
    const success = check(analyticsRes, {
      "analytics status 200 or 404": (r) => r.status === 200 || r.status === 404,
      "analytics response under 250ms": (r) => r.timings.duration < 250,
    });
    errorRate.add(!success);
  });

  sleep(0.1);
}
