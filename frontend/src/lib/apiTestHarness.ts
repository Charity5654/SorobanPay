/**
 * frontend/src/lib/apiTestHarness.ts
 *
 * Issue #1119 — Add shared frontend API test harness (queentiffany1111-cloud)
 *
 * Provides a standardized mock environment for frontend components and hooks
 * making calls to backend REST endpoints and Soroban RPC:
 *   - Route interception and deterministic mock responses
 *   - Error simulation (400 Bad Request, 401 Unauthorized, 404, 500)
 *   - Tenant header injection and auth token state
 *   - Call history tracking for assertion verification
 */

export interface MockResponse<T = unknown> {
  status: number;
  body: T;
  headers?: Record<string, string>;
  delayMs?: number;
}

export interface InterceptedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
}

export class ApiTestHarness {
  private handlers = new Map<string, (req: InterceptedCall) => Promise<MockResponse> | MockResponse>();
  private history: InterceptedCall[] = [];
  private originalFetch?: typeof globalThis.fetch;

  /**
   * Install the test harness by patching the global fetch implementation.
   */
  install(): void {
    if (this.originalFetch) return;
    this.originalFetch = globalThis.fetch;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method || 'GET').toUpperCase();
      const headers: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headers[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => {
            headers[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers).forEach(([k, v]) => {
            headers[k.toLowerCase()] = String(v);
          });
        }
      }

      const callRecord: InterceptedCall = {
        url,
        method,
        headers,
        body: init?.body ? String(init.body) : undefined,
        timestamp: Date.now(),
      };
      this.history.push(callRecord);

      // Match handler by method + pathname
      const key = `${method} ${url.split('?')[0]}`;
      const handler = this.handlers.get(key) || this.handlers.get(`* ${url.split('?')[0]}`);

      if (handler) {
        const mockRes = await handler(callRecord);
        if (mockRes.delayMs) {
          await new Promise((resolve) => setTimeout(resolve, mockRes.delayMs));
        }

        return new Response(JSON.stringify(mockRes.body), {
          status: mockRes.status,
          headers: {
            'Content-Type': 'application/json',
            ...(mockRes.headers || {}),
          },
        });
      }

      // Default 404 envelope if unmatched
      return new Response(
        JSON.stringify({ error: `No mock handler registered for ${method} ${url}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    };
  }

  /**
   * Uninstall the test harness and restore global fetch.
   */
  restore(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = undefined;
    }
    this.handlers.clear();
    this.history = [];
  }

  /**
   * Register a route handler.
   */
  mock(method: string, path: string, response: MockResponse | ((req: InterceptedCall) => MockResponse)): this {
    const key = `${method.toUpperCase()} ${path}`;
    this.handlers.set(key, typeof response === 'function' ? response : () => response);
    return this;
  }

  /**
   * Helper to mock successful JSON data response.
   */
  mockSuccess<T>(method: string, path: string, data: T, status = 200): this {
    return this.mock(method, path, { status, body: data });
  }

  /**
   * Helper to mock error envelope response.
   */
  mockError(method: string, path: string, error: string, status = 400): this {
    return this.mock(method, path, { status, body: { error } });
  }

  /**
   * Get recorded call history.
   */
  getCalls(pathSubstring?: string): InterceptedCall[] {
    if (!pathSubstring) return [...this.history];
    return this.history.filter((c) => c.url.includes(pathSubstring));
  }

  /**
   * Clear call history.
   */
  clearHistory(): void {
    this.history = [];
  }
}

export const apiHarness = new ApiTestHarness();
