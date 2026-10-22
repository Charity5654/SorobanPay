/**
 * api_client.test.ts
 *
 * Unit tests for the typed API client boundary (api_client.ts).
 *
 * Coverage:
 *  - ApiError construction, properties, prototype chain, and isApiError guard
 *  - ApiErrorCode mappings for every HTTP status class
 *  - Default header assembly (Content-Type, Accept, Authorization, X-Wallet, X-Stellar-Network)
 *  - Successful GET / POST / PUT / PATCH / DELETE with envelope unwrapping
 *  - Non-envelope responses (unwrapEnvelope: false)
 *  - All HTTP error status codes → correct ApiErrorCode
 *  - Network-level failures → NETWORK_ERROR
 *  - AbortSignal cancellation → CANCELLED
 *  - JSON parse failures → PARSE_ERROR
 *  - Missing envelope "data" field → PARSE_ERROR
 *  - GraphQL success (query + variables)
 *  - GraphQL partial errors → GRAPHQL_ERROR
 *  - GraphQL missing data field → PARSE_ERROR
 *  - Singleton helpers (getDefaultApiClient, setDefaultApiClient)
 *  - Trailing-slash normalization in baseUrl
 *  - Extra per-request headers merged over defaults
 *
 * Issue #1039 — Add typed API client boundary
 */

import {
  ApiClient,
  ApiError,
  ApiErrorCode,
  isApiError,
  createApiClient,
  getDefaultApiClient,
  setDefaultApiClient,
  type ApiClientOptions,
  type ApiEnvelope,
  type GraphQlResponse,
} from './api_client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal fetch mock that returns the given response. */
function mockFetch(
  body: unknown,
  opts: { status?: number; ok?: boolean; headers?: Record<string, string> } = {},
): jest.Mock {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? status >= 200 && status < 300;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    headers: new Headers(opts.headers ?? {}),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

/** Build a fetch mock that returns raw text (for non-JSON scenarios). */
function mockFetchText(
  text: string,
  opts: { status?: number; ok?: boolean } = {},
): jest.Mock {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? status >= 200 && status < 300;
  return jest.fn().mockResolvedValue({
    ok,
    status,
    text: jest.fn().mockResolvedValue(text),
  });
}

/** Build a fetch mock that throws (network-level failure). */
function mockFetchNetworkError(message = 'Failed to fetch'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(message));
}

/** Build a fetch mock that throws an AbortError. */
function mockFetchAbortError(): jest.Mock {
  const err = new Error('The user aborted a request.');
  err.name = 'AbortError';
  return jest.fn().mockRejectedValue(err);
}

function makeClient(
  overrides: Partial<ApiClientOptions> = {},
  fetchImpl: jest.Mock = mockFetch({ data: null }),
): ApiClient {
  return new ApiClient({
    baseUrl: 'https://api.sorobanpay.test',
    fetchImpl,
    ...overrides,
  });
}

// ─── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('is an instance of Error', () => {
    const err = new ApiError(ApiErrorCode.UNKNOWN, 'test');
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of ApiError', () => {
    const err = new ApiError(ApiErrorCode.UNKNOWN, 'test');
    expect(err).toBeInstanceOf(ApiError);
  });

  it('name is "ApiError"', () => {
    const err = new ApiError(ApiErrorCode.NETWORK_ERROR, 'oops');
    expect(err.name).toBe('ApiError');
  });

  it('stores code', () => {
    const err = new ApiError(ApiErrorCode.NOT_FOUND, 'missing');
    expect(err.code).toBe(ApiErrorCode.NOT_FOUND);
  });

  it('stores message', () => {
    const err = new ApiError(ApiErrorCode.SERVER_ERROR, 'boom');
    expect(err.message).toBe('boom');
  });

  it('stores optional status', () => {
    const err = new ApiError(ApiErrorCode.NOT_FOUND, 'missing', { status: 404 });
    expect(err.status).toBe(404);
  });

  it('stores optional body', () => {
    const err = new ApiError(ApiErrorCode.BAD_REQUEST, 'bad', {
      status: 400,
      body: '{"error":{"message":"bad input"}}',
    });
    expect(err.body).toBe('{"error":{"message":"bad input"}}');
  });

  it('stores graphqlErrors', () => {
    const gqlErrs = [{ message: 'field not found', path: ['merchant'] }];
    const err = new ApiError(ApiErrorCode.GRAPHQL_ERROR, 'gql err', {
      graphqlErrors: gqlErrs,
    });
    expect(err.graphqlErrors).toEqual(gqlErrs);
  });

  it('status is undefined when not provided', () => {
    const err = new ApiError(ApiErrorCode.CANCELLED, 'aborted');
    expect(err.status).toBeUndefined();
  });
});

// ─── isApiError ───────────────────────────────────────────────────────────────

describe('isApiError', () => {
  it('returns true for ApiError instances', () => {
    expect(isApiError(new ApiError(ApiErrorCode.UNKNOWN, 'x'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isApiError(new Error('plain'))).toBe(false);
  });

  it('returns false for strings', () => {
    expect(isApiError('error string')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isApiError(undefined)).toBe(false);
  });

  it('returns false for plain objects', () => {
    expect(isApiError({ code: 'NETWORK_ERROR', message: 'oops' })).toBe(false);
  });
});

// ─── ApiErrorCode values ──────────────────────────────────────────────────────

describe('ApiErrorCode values', () => {
  it.each([
    ['NETWORK_ERROR', 'NETWORK_ERROR'],
    ['CANCELLED', 'CANCELLED'],
    ['BAD_REQUEST', 'BAD_REQUEST'],
    ['UNAUTHORIZED', 'UNAUTHORIZED'],
    ['FORBIDDEN', 'FORBIDDEN'],
    ['NOT_FOUND', 'NOT_FOUND'],
    ['CONFLICT', 'CONFLICT'],
    ['UNPROCESSABLE', 'UNPROCESSABLE'],
    ['RATE_LIMITED', 'RATE_LIMITED'],
    ['SERVER_ERROR', 'SERVER_ERROR'],
    ['PARSE_ERROR', 'PARSE_ERROR'],
    ['GRAPHQL_ERROR', 'GRAPHQL_ERROR'],
    ['UNKNOWN', 'UNKNOWN'],
  ] as const)('ApiErrorCode.%s === "%s"', (key, value) => {
    expect(ApiErrorCode[key]).toBe(value);
  });

  it('has 13 distinct codes', () => {
    const codes = Object.values(ApiErrorCode);
    expect(codes.length).toBe(13);
    expect(new Set(codes).size).toBe(13);
  });
});

// ─── Default headers ──────────────────────────────────────────────────────────

describe('default headers', () => {
  it('sets Content-Type: application/json', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/health');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('sets Accept: application/json', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/health');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept']).toBe(
      'application/json',
    );
  });

  it('sets Authorization when authToken is provided', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({ authToken: 'secret-token' }, fetch);
    await client.get('/private');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer secret-token',
    );
  });

  it('omits Authorization when authToken is not provided', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/public');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('sets X-Wallet-Public-Key when walletPublicKey is provided', async () => {
    const fetch = mockFetch({ data: null });
    const pk = 'GABC123';
    const client = makeClient({ walletPublicKey: pk }, fetch);
    await client.get('/subscriptions');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Wallet-Public-Key']).toBe(pk);
  });

  it('omits X-Wallet-Public-Key when walletPublicKey is not provided', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/subscriptions');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)['X-Wallet-Public-Key'],
    ).toBeUndefined();
  });

  it('sets X-Stellar-Network when network is provided', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({ network: 'testnet' }, fetch);
    await client.get('/subscriptions');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Stellar-Network']).toBe(
      'testnet',
    );
  });

  it('omits X-Stellar-Network when network is not provided', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/subscriptions');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>)['X-Stellar-Network'],
    ).toBeUndefined();
  });

  it('merges per-request headers over defaults', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/subscriptions', {
      headers: { 'X-Custom-Header': 'custom-value' },
    });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Custom-Header']).toBe('custom-value');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('per-request headers override defaults', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({}, fetch);
    await client.get('/subscriptions', {
      headers: { 'Content-Type': 'text/plain' },
    });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'text/plain',
    );
  });
});

// ─── Successful requests ──────────────────────────────────────────────────────

describe('GET (success)', () => {
  it('returns unwrapped data from envelope', async () => {
    const fetch = mockFetch({ data: [{ id: '1', amount: '100' }] });
    const client = makeClient({}, fetch);
    const result = await client.get<Array<{ id: string; amount: string }>>(
      '/payments',
    );
    expect(result).toEqual([{ id: '1', amount: '100' }]);
  });

  it('builds correct URL from baseUrl + path', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({ baseUrl: 'https://api.example.com' }, fetch);
    await client.get('/subscriptions');
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/subscriptions');
  });

  it('strips trailing slash from baseUrl', async () => {
    const fetch = mockFetch({ data: null });
    const client = makeClient({ baseUrl: 'https://api.example.com/' }, fetch);
    await client.get('/subscriptions');
    expect(fetch.mock.calls[0][0]).toBe('https://api.example.com/subscriptions');
  });

  it('returns raw response when unwrapEnvelope is false', async () => {
    const fetch = mockFetch({ count: 42 });
    const client = makeClient({}, fetch);
    const result = await client.get<{ count: number }>('/stats', {
      unwrapEnvelope: false,
    });
    expect(result).toEqual({ count: 42 });
  });
});

describe('POST (success)', () => {
  it('returns unwrapped data from envelope', async () => {
    const newSub = { id: 'sub_123', subscriber: 'G...', merchant: 'G...' };
    const fetch = mockFetch({ data: newSub });
    const client = makeClient({}, fetch);
    const result = await client.post<typeof newSub>('/subscriptions', {
      subscriber: 'G...',
      merchant: 'G...',
    });
    expect(result).toEqual(newSub);
  });

  it('uses POST method', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    await client.post('/subscriptions', {});
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('serializes body as JSON', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    const body = { subscriber: 'GABC', amount: '100' };
    await client.post('/subscriptions', body);
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('sends no body when body is undefined', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    await client.post('/trigger');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });
});

describe('PUT (success)', () => {
  it('uses PUT method', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    await client.put('/subscriptions/sub_1', { amount: '200' });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
  });
});

describe('PATCH (success)', () => {
  it('uses PATCH method', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    await client.patch('/subscriptions/sub_1', { interval: 86400 });
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
  });
});

describe('DELETE (success)', () => {
  it('uses DELETE method', async () => {
    const fetch = mockFetch({ data: {} });
    const client = makeClient({}, fetch);
    await client.delete('/subscriptions/sub_1');
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
  });
});

// ─── HTTP error status codes ──────────────────────────────────────────────────

describe('HTTP error handling', () => {
  it.each([
    [400, ApiErrorCode.BAD_REQUEST],
    [401, ApiErrorCode.UNAUTHORIZED],
    [403, ApiErrorCode.FORBIDDEN],
    [404, ApiErrorCode.NOT_FOUND],
    [409, ApiErrorCode.CONFLICT],
    [422, ApiErrorCode.UNPROCESSABLE],
    [429, ApiErrorCode.RATE_LIMITED],
    [500, ApiErrorCode.SERVER_ERROR],
    [502, ApiErrorCode.SERVER_ERROR],
    [503, ApiErrorCode.SERVER_ERROR],
  ])('HTTP %i maps to ApiErrorCode.%s', async (status, expectedCode) => {
    const fetch = mockFetch({ error: { message: 'error' } }, { status, ok: false });
    const client = makeClient({}, fetch);
    await expect(client.get('/anything')).rejects.toMatchObject({
      code: expectedCode,
      status,
    });
  });

  it('throws ApiError on non-2xx responses', async () => {
    const fetch = mockFetch(
      { error: { message: 'Not found' } },
      { status: 404, ok: false },
    );
    const client = makeClient({}, fetch);
    await expect(client.get('/missing')).rejects.toBeInstanceOf(ApiError);
  });

  it('extracts error.message from JSON error body', async () => {
    const fetch = mockFetch(
      { error: { message: 'Resource not found' } },
      { status: 404, ok: false },
    );
    const client = makeClient({}, fetch);
    await expect(client.get('/missing')).rejects.toMatchObject({
      message: 'Resource not found',
    });
  });

  it('extracts top-level message from JSON error body', async () => {
    const fetch = mockFetch(
      { message: 'Invalid address' },
      { status: 400, ok: false },
    );
    const client = makeClient({}, fetch);
    await expect(client.get('/bad')).rejects.toMatchObject({
      message: 'Invalid address',
    });
  });

  it('falls back to "HTTP <status>" when body is not JSON', async () => {
    const fetchImpl = mockFetchText('Internal Server Error', {
      status: 500,
      ok: false,
    });
    const client = makeClient({}, fetchImpl);
    await expect(client.get('/crash')).rejects.toMatchObject({
      message: 'HTTP 500',
    });
  });

  it('attaches status to thrown ApiError', async () => {
    const fetch = mockFetch({}, { status: 422, ok: false });
    const client = makeClient({}, fetch);
    try {
      await client.get('/invalid');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      expect((err as ApiError).status).toBe(422);
    }
  });
});

// ─── Network failures ─────────────────────────────────────────────────────────

describe('Network failures', () => {
  it('throws ApiError with NETWORK_ERROR on fetch throw', async () => {
    const client = makeClient({}, mockFetchNetworkError('ECONNREFUSED'));
    await expect(client.get('/subscriptions')).rejects.toMatchObject({
      code: ApiErrorCode.NETWORK_ERROR,
    });
  });

  it('NETWORK_ERROR message includes original error', async () => {
    const client = makeClient({}, mockFetchNetworkError('ETIMEDOUT'));
    await expect(client.get('/subscriptions')).rejects.toMatchObject({
      message: expect.stringContaining('ETIMEDOUT'),
    });
  });
});

// ─── Cancellation ─────────────────────────────────────────────────────────────

describe('Cancellation via AbortSignal', () => {
  it('throws ApiError with CANCELLED when AbortError is thrown', async () => {
    const client = makeClient({}, mockFetchAbortError());
    const controller = new AbortController();
    await expect(
      client.get('/subscriptions', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: ApiErrorCode.CANCELLED });
  });

  it('CANCELLED error has no status', async () => {
    const client = makeClient({}, mockFetchAbortError());
    try {
      await client.get('/subscriptions', { signal: new AbortController().signal });
    } catch (err) {
      expect((err as ApiError).status).toBeUndefined();
    }
  });

  it('forwards signal to fetch', async () => {
    const fetchImpl = mockFetch({ data: null });
    const client = makeClient({}, fetchImpl);
    const controller = new AbortController();
    await client.get('/health', { signal: controller.signal });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ─── JSON parse failures ──────────────────────────────────────────────────────

describe('JSON parse failures', () => {
  it('throws PARSE_ERROR when response body is not valid JSON', async () => {
    const fetchImpl = mockFetchText('not-json-at-all', { status: 200, ok: true });
    const client = makeClient({}, fetchImpl);
    await expect(client.get('/broken')).rejects.toMatchObject({
      code: ApiErrorCode.PARSE_ERROR,
    });
  });

  it('throws PARSE_ERROR when envelope lacks "data" field', async () => {
    const fetchImpl = mockFetch({ result: 'ok' }); // no "data" key
    const client = makeClient({}, fetchImpl);
    await expect(client.get('/wrong-envelope')).rejects.toMatchObject({
      code: ApiErrorCode.PARSE_ERROR,
    });
  });

  it('does NOT throw PARSE_ERROR when unwrapEnvelope is false and body is valid JSON', async () => {
    const fetchImpl = mockFetch({ result: 'ok' });
    const client = makeClient({}, fetchImpl);
    const result = await client.get<{ result: string }>('/raw', {
      unwrapEnvelope: false,
    });
    expect(result).toEqual({ result: 'ok' });
  });
});

// ─── GraphQL ──────────────────────────────────────────────────────────────────

describe('GraphQL', () => {
  it('sends query to /graphql by default', async () => {
    const fetchImpl = mockFetch({ data: { merchant: { id: '1' } } });
    const client = makeClient({}, fetchImpl);
    await client.graphql('query { merchant { id } }');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.sorobanpay.test/graphql',
    );
  });

  it('uses custom path when provided', async () => {
    const fetchImpl = mockFetch({ data: {} });
    const client = makeClient({}, fetchImpl);
    await client.graphql('query { ping }', { path: '/gql' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.sorobanpay.test/gql');
  });

  it('returns data field on success', async () => {
    const payload = { merchant: { id: '1', name: 'Acme' } };
    const fetchImpl = mockFetch({ data: payload });
    const client = makeClient({}, fetchImpl);
    const result = await client.graphql<typeof payload>(
      'query { merchant { id name } }',
    );
    expect(result).toEqual(payload);
  });

  it('sends variables in request body', async () => {
    const fetchImpl = mockFetch({ data: {} });
    const client = makeClient({}, fetchImpl);
    const vars = { merchantId: 'm_123' };
    await client.graphql('query GetMerchant($merchantId: ID!) { merchant(id: $merchantId) { id } }', {
      variables: vars,
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { variables: unknown };
    expect(body.variables).toEqual(vars);
  });

  it('throws GRAPHQL_ERROR when errors array is non-empty', async () => {
    const fetchImpl = mockFetch({
      data: null,
      errors: [{ message: 'Field not found: nonExistent' }],
    });
    const client = makeClient({}, fetchImpl);
    await expect(
      client.graphql('query { nonExistent }'),
    ).rejects.toMatchObject({ code: ApiErrorCode.GRAPHQL_ERROR });
  });

  it('GRAPHQL_ERROR message joins all error messages', async () => {
    const fetchImpl = mockFetch({
      data: null,
      errors: [
        { message: 'First problem' },
        { message: 'Second problem' },
      ],
    });
    const client = makeClient({}, fetchImpl);
    await expect(client.graphql('query { fail }')).rejects.toMatchObject({
      message: 'First problem; Second problem',
    });
  });

  it('attaches graphqlErrors to the thrown ApiError', async () => {
    const gqlErrors = [{ message: 'Unauthorized', path: ['merchant'] }];
    const fetchImpl = mockFetch({ data: null, errors: gqlErrors });
    const client = makeClient({}, fetchImpl);
    try {
      await client.graphql('query { merchant { id } }');
    } catch (err) {
      expect(isApiError(err)).toBe(true);
      expect((err as ApiError).graphqlErrors).toEqual(gqlErrors);
    }
  });

  it('throws PARSE_ERROR when data field is missing and no errors', async () => {
    const fetchImpl = mockFetch({ errors: [] });
    const client = makeClient({}, fetchImpl);
    await expect(client.graphql('query { merchant { id } }')).rejects.toMatchObject({
      code: ApiErrorCode.PARSE_ERROR,
    });
  });

  it('forwards AbortSignal to underlying fetch', async () => {
    const fetchImpl = mockFetch({ data: {} });
    const client = makeClient({}, fetchImpl);
    const controller = new AbortController();
    await client.graphql('query { ping }', { signal: controller.signal });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

// ─── createApiClient factory ──────────────────────────────────────────────────

describe('createApiClient', () => {
  it('returns an ApiClient instance', () => {
    const client = createApiClient({ baseUrl: 'https://api.example.com' });
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('constructed client uses provided baseUrl', async () => {
    const fetchImpl = mockFetch({ data: null });
    const client = createApiClient({
      baseUrl: 'https://custom.api.example.com',
      fetchImpl,
    });
    await client.get('/ping');
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://custom.api.example.com/ping',
    );
  });
});

// ─── Singleton helpers ────────────────────────────────────────────────────────

describe('getDefaultApiClient / setDefaultApiClient', () => {
  afterEach(() => {
    // Always reset the singleton after each test to avoid cross-test pollution.
    setDefaultApiClient(null);
  });

  it('returns an ApiClient instance', () => {
    const client = getDefaultApiClient();
    expect(client).toBeInstanceOf(ApiClient);
  });

  it('returns the same instance on successive calls (singleton)', () => {
    const a = getDefaultApiClient();
    const b = getDefaultApiClient();
    expect(a).toBe(b);
  });

  it('setDefaultApiClient replaces the singleton', () => {
    const custom = createApiClient({ baseUrl: 'https://replaced.example.com' });
    setDefaultApiClient(custom);
    expect(getDefaultApiClient()).toBe(custom);
  });

  it('setDefaultApiClient(null) resets to lazy default', () => {
    const original = getDefaultApiClient();
    setDefaultApiClient(null);
    const fresh = getDefaultApiClient();
    // A new instance should be created after reset.
    expect(fresh).not.toBe(original);
    expect(fresh).toBeInstanceOf(ApiClient);
  });
});

// ─── Loading state (async flow) ───────────────────────────────────────────────

describe('Loading / async lifecycle', () => {
  it('resolves only after fetch completes', async () => {
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchImpl = jest.fn().mockReturnValue(pending);
    const client = makeClient({}, fetchImpl as unknown as jest.Mock);

    let resolved = false;
    const promise = client.get('/slow').then(() => {
      resolved = true;
    });

    // Not yet resolved
    expect(resolved).toBe(false);

    // Unblock fetch
    resolveFetch({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ data: 'done' })),
    } as unknown as Response);

    await promise;
    expect(resolved).toBe(true);
  });

  it('can be awaited multiple times without extra fetches', async () => {
    const fetchImpl = mockFetch({ data: 42 });
    const client = makeClient({}, fetchImpl);
    const result1 = await client.get<number>('/count');
    const result2 = await client.get<number>('/count');
    expect(result1).toBe(42);
    expect(result2).toBe(42);
    // Two separate awaits = two separate fetches (no hidden caching at this layer)
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// ─── Wallet / network safety ──────────────────────────────────────────────────

describe('Wallet and network safety', () => {
  it('does not include auth token in the URL', async () => {
    const fetchImpl = mockFetch({ data: null });
    const client = makeClient({ authToken: 'super-secret' }, fetchImpl);
    await client.get('/private');
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain('super-secret');
  });

  it('auth token is placed in Authorization header only', async () => {
    const fetchImpl = mockFetch({ data: null });
    const client = makeClient({ authToken: 'tok_abc' }, fetchImpl);
    await client.get('/private');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
    expect(JSON.stringify(headers)).not.toContain('tok_abc');
  });

  it('passes wallet public key as a safe header (not auth)', async () => {
    const fetchImpl = mockFetch({ data: null });
    const pk = 'GABC_PUBLIC_KEY';
    const client = makeClient({ walletPublicKey: pk }, fetchImpl);
    await client.get('/subscriptions');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    // Public key in header is intentional and safe
    expect(headers['X-Wallet-Public-Key']).toBe(pk);
    // Not in Authorization header
    expect(headers['Authorization']).toBeUndefined();
  });

  it('network name forwarded in X-Stellar-Network header', async () => {
    const fetchImpl = mockFetch({ data: null });
    const client = makeClient({ network: 'mainnet' }, fetchImpl);
    await client.get('/subscriptions');
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Stellar-Network']).toBe(
      'mainnet',
    );
  });
});
