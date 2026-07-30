/**
 * frontend/tests/pact/api.consumer.pact.test.ts
 *
 * TEST-107 — Consumer-driven contract tests (Pact) for the SorobanPay backend API.
 *
 * The frontend acts as the *consumer* of the backend REST API. These tests
 * define the contract: for each API call the frontend makes, we record:
 *   - the request shape (method, path, headers, body)
 *   - the minimum response shape the frontend requires (status + body structure)
 *
 * Pact starts a local mock server that replays these interactions. The generated
 * pact file (`pacts/SorobanPayFrontend-SorobanPayBackend.json`) is then used by
 * the *provider* (backend) tests to verify its implementation satisfies the contract.
 *
 * Contracts covered:
 *   CONTRACT-1: GET /api/v1/subscriptions/merchant/:address  — subscription list
 *   CONTRACT-2: GET /api/v1/subscriptions/merchant/:address/payments  — payment history
 *   CONTRACT-3: GET /health  — health check
 *   CONTRACT-4: POST /api/v1/webhooks/endpoints  — webhook registration
 *   CONTRACT-5: GET /api/v1/subscriptions/merchant/:address (with ?token= filter)
 *
 * Run:
 *   cd frontend && npx jest tests/pact/api.consumer.pact.test.ts --verbose
 *
 * The generated pact file will be written to:
 *   <repo-root>/pacts/SorobanPayFrontend-SorobanPayBackend.json
 *
 * References:
 *   Pact JS: https://docs.pact.io/implementation_guides/javascript
 *   Issue TEST-107
 *   Backend routes: backend/src/routes/subscriptions.ts, webhooks.ts
 */

import path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like, eachLike, string, integer, nullValue, datetime } = MatchersV3;

// ─── Pact provider instance ───────────────────────────────────────────────────

const provider = new PactV3({
  consumer: 'SorobanPayFrontend',
  provider: 'SorobanPayBackend',
  // Pact files are written to the shared /pacts directory at the repo root
  dir: path.resolve(__dirname, '../../../pacts'),
  logLevel: 'warn',
});

// ─── Constants used in interactions ──────────────────────────────────────────

const MERCHANT_ADDRESS = 'GMERCHANT0000000000000000000000000000000000000000000001';
const SUBSCRIBER_ADDRESS = 'GSUB0000000000000000000000000000000000000000000000001';
const TOKEN_ADDRESS = 'CTOK0000000000000000000000000000000000000000000000001';

// ─── Helper: minimal fetch wrapper (mirrors what frontend lib/api.ts would do) ──

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// ─── CONTRACT-1: Subscription list ───────────────────────────────────────────

describe('CONTRACT-1: GET /api/v1/subscriptions/merchant/:address', () => {
  /**
   * The frontend fetches the list of active subscriptions for a merchant to
   * display in the merchant dashboard.
   *
   * Minimum shape the frontend requires:
   *   - An array (may be empty)
   *   - Each element has: subscriber (string), merchant (string), token (string),
   *     amount (string), status (string)
   *   - interval and nextPaymentDue may be null
   */
  it('returns a list of subscriptions for a merchant', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'merchant has one active subscription' }],
        uponReceiving: 'a request for merchant subscriptions',
        withRequest: {
          method: 'GET',
          path: `/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}`,
          headers: { Accept: 'application/json' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: eachLike({
            subscriber: string(SUBSCRIBER_ADDRESS),
            merchant: string(MERCHANT_ADDRESS),
            token: string(TOKEN_ADDRESS),
            amount: string('1000000'),
            status: string('ACTIVE'),
            interval: nullValue(),
            nextPaymentDue: nullValue(),
            lastPaymentAt: nullValue(),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}`,
          { headers: { Accept: 'application/json' } },
        ) as unknown[];

        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        const sub = data[0] as Record<string, unknown>;
        expect(typeof sub.subscriber).toBe('string');
        expect(typeof sub.merchant).toBe('string');
        expect(typeof sub.token).toBe('string');
        expect(typeof sub.amount).toBe('string');
        expect(typeof sub.status).toBe('string');
        // interval and nextPaymentDue may be null (not available from event table)
        expect(sub).toHaveProperty('interval');
        expect(sub).toHaveProperty('nextPaymentDue');
      });
  });

  it('returns an empty array when merchant has no subscriptions', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'merchant has no subscriptions' }],
        uponReceiving: 'a request for merchant subscriptions with no results',
        withRequest: {
          method: 'GET',
          path: `/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}`,
          headers: { Accept: 'application/json' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: [],
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}`,
          { headers: { Accept: 'application/json' } },
        );
        expect(data).toEqual([]);
      });
  });
});

// ─── CONTRACT-2: Payment history ─────────────────────────────────────────────

describe('CONTRACT-2: GET /api/v1/subscriptions/merchant/:address/payments', () => {
  /**
   * The frontend fetches payment history to display in the payment history panel.
   *
   * Minimum shape:
   *   - Array of payment events
   *   - Each has: subscriber, merchant, token, amount, ledgerTimestamp
   */
  it('returns payment history for a merchant', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'merchant has executed payments' }],
        uponReceiving: 'a request for payment history',
        withRequest: {
          method: 'GET',
          path: `/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}/payments`,
          headers: { Accept: 'application/json' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: eachLike({
            id: string('1'),
            subscriber: string(SUBSCRIBER_ADDRESS),
            merchant: string(MERCHANT_ADDRESS),
            token: string(TOKEN_ADDRESS),
            amount: string('1000000'),
            type: string('executed'),
            ledgerTimestamp: integer(1000),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}/payments`,
          { headers: { Accept: 'application/json' } },
        ) as unknown[];

        expect(Array.isArray(data)).toBe(true);
        const payment = data[0] as Record<string, unknown>;
        expect(typeof payment.subscriber).toBe('string');
        expect(typeof payment.merchant).toBe('string');
        expect(typeof payment.amount).toBe('string');
      });
  });

  it('supports ?limit= and ?offset= for pagination', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'merchant has executed payments' }],
        uponReceiving: 'a paginated request for payment history',
        withRequest: {
          method: 'GET',
          path: `/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}/payments`,
          query: { limit: '10', offset: '0' },
          headers: { Accept: 'application/json' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: eachLike({
            id: string('1'),
            subscriber: string(SUBSCRIBER_ADDRESS),
            merchant: string(MERCHANT_ADDRESS),
            token: string(TOKEN_ADDRESS),
            amount: string('1000000'),
            type: string('executed'),
            ledgerTimestamp: integer(1000),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}/payments?limit=10&offset=0`,
          { headers: { Accept: 'application/json' } },
        );
        expect(Array.isArray(data)).toBe(true);
      });
  });
});

// ─── CONTRACT-3: Health check ─────────────────────────────────────────────────

describe('CONTRACT-3: GET /health', () => {
  /**
   * The frontend polls /health to determine if the backend is reachable.
   * Minimum shape: { status: string } where status === 'ok' on success.
   */
  it('returns a healthy status', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'backend is healthy' }],
        uponReceiving: 'a health check request',
        withRequest: {
          method: 'GET',
          path: '/health',
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            status: string('ok'),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(`${mockServer.url}/health`) as Record<string, unknown>;
        expect(data.status).toBe('ok');
      });
  });
});

// ─── CONTRACT-4: Webhook registration ────────────────────────────────────────

describe('CONTRACT-4: POST /api/v1/webhooks/endpoints', () => {
  /**
   * The merchant portal registers a webhook URL to receive payment notifications.
   * Minimum response shape: { id, merchant, url, active }
   */
  it('registers a webhook endpoint and returns the created record', async () => {
    const webhookBody = {
      merchant: MERCHANT_ADDRESS,
      url: 'https://example.com/webhook',
    };

    await provider
      .addInteraction({
        states: [{ description: 'no webhook exists for this merchant/url pair' }],
        uponReceiving: 'a request to register a webhook endpoint',
        withRequest: {
          method: 'POST',
          path: '/api/v1/webhooks/endpoints',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: webhookBody,
        },
        willRespondWith: {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
          body: like({
            id: string('1'),
            merchant: string(MERCHANT_ADDRESS),
            url: string('https://example.com/webhook'),
            active: true,
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/webhooks/endpoints`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(webhookBody),
          },
        ) as Record<string, unknown>;

        expect(data.merchant).toBe(MERCHANT_ADDRESS);
        expect(data.url).toBe('https://example.com/webhook');
        expect(data.active).toBe(true);
      });
  });

  it('returns 400 when merchant field is missing', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'backend is running' }],
        uponReceiving: 'a malformed webhook registration request missing merchant',
        withRequest: {
          method: 'POST',
          path: '/api/v1/webhooks/endpoints',
          headers: {
            'Content-Type': 'application/json',
          },
          body: { url: 'https://example.com/webhook' },
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
          body: like({ error: string('merchant and url are required') }),
        },
      })
      .executeTest(async (mockServer) => {
        const res = await fetch(`${mockServer.url}/api/v1/webhooks/endpoints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/webhook' }),
        });
        expect(res.status).toBe(400);
        const data = await res.json() as Record<string, unknown>;
        expect(typeof data.error).toBe('string');
      });
  });
});

// ─── CONTRACT-5: Subscription list filtered by token ─────────────────────────

describe('CONTRACT-5: GET /api/v1/subscriptions/merchant/:address?token=', () => {
  /**
   * The frontend can filter subscriptions by token address.
   * The backend must honour the ?token= query parameter.
   */
  it('filters subscriptions by token address', async () => {
    await provider
      .addInteraction({
        states: [{ description: 'merchant has subscriptions for multiple tokens' }],
        uponReceiving: 'a request for subscriptions filtered by token',
        withRequest: {
          method: 'GET',
          path: `/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}`,
          query: { token: TOKEN_ADDRESS },
          headers: { Accept: 'application/json' },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: eachLike({
            subscriber: string(SUBSCRIBER_ADDRESS),
            merchant: string(MERCHANT_ADDRESS),
            token: string(TOKEN_ADDRESS),
            amount: string('1000000'),
            status: string('ACTIVE'),
            interval: nullValue(),
            nextPaymentDue: nullValue(),
            lastPaymentAt: nullValue(),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const data = await fetchJson(
          `${mockServer.url}/api/v1/subscriptions/merchant/${MERCHANT_ADDRESS}?token=${TOKEN_ADDRESS}`,
          { headers: { Accept: 'application/json' } },
        ) as unknown[];

        expect(Array.isArray(data)).toBe(true);
        for (const sub of data) {
          expect((sub as Record<string, unknown>).token).toBe(TOKEN_ADDRESS);
        }
      });
  });
});
