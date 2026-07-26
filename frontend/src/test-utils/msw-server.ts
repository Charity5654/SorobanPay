/**
 * msw-server.ts
 *
 * MSW (Mock Service Worker) server setup for Jest tests.
 * Use this to intercept RPC/network calls in unit tests.
 *
 * Usage:
 *   import { server } from '@/test-utils/msw-server';
 *   // handlers are registered via server.use(...) inside tests
 *
 * Issue #433 – MSW mocks for RPC calls
 */
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// ── Default Soroban RPC handlers ─────────────────────────────────────────────

/**
 * Default handler for the Soroban RPC endpoint.
 * Returns a minimal JSON-RPC success envelope.
 * Individual tests can override this with server.use(...).
 */
export const defaultRpcHandler = http.post(
  'https://soroban-testnet.stellar.org',
  () => {
    return HttpResponse.json({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
  },
);

/**
 * Handler that simulates an RPC network error.
 */
export const rpcNetworkErrorHandler = http.post(
  'https://soroban-testnet.stellar.org',
  () => {
    return HttpResponse.error();
  },
);

/**
 * Handler that simulates a slow (timeout) RPC response.
 * Use in conjunction with jest.useFakeTimers() to control timing.
 */
export const rpcTimeoutHandler = http.post(
  'https://soroban-testnet.stellar.org',
  async () => {
    // Artificially delay — tests can fast-forward timers
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return HttpResponse.json({ jsonrpc: '2.0', id: 1, result: {} });
  },
);

/**
 * Factory: create a handler that returns a specific getAccount response.
 */
export function makeGetAccountHandler(publicKey: string, sequence = '100') {
  return http.post('https://soroban-testnet.stellar.org', async ({ request }) => {
    const body = (await request.json()) as { method?: string };
    if (body.method === 'getAccount') {
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          id: publicKey,
          sequence,
          balances: [{ asset_type: 'native', balance: '100.0000000' }],
        },
      });
    }
    return HttpResponse.json({ jsonrpc: '2.0', id: 1, result: {} });
  });
}

/**
 * Factory: create a handler that returns a simulateTransaction response.
 */
export function makeSimulateHandler(minResourceFee = '500') {
  return http.post('https://soroban-testnet.stellar.org', async ({ request }) => {
    const body = (await request.json()) as { method?: string };
    if (body.method === 'simulateTransaction') {
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          minResourceFee,
          transactionData: '',
          events: [],
        },
      });
    }
    return HttpResponse.json({ jsonrpc: '2.0', id: 1, result: {} });
  });
}

// ── MSW Node server ──────────────────────────────────────────────────────────

export const server = setupServer(defaultRpcHandler);

// Lifecycle helpers (call from jest.setup.ts or per test suite)
export function startServer() {
  server.listen({ onUnhandledRequest: 'warn' });
}

export function resetHandlers() {
  server.resetHandlers();
}

export function closeServer() {
  server.close();
}
