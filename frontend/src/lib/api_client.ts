/**
 * api_client.ts
 *
 * Typed API client boundary for SorobanPay.
 *
 * Centralizes:
 *  - Base URL resolution from runtime config
 *  - Default request headers (Content-Type, Accept, Authorization, X-Wallet)
 *  - Response type parsing with full TypeScript generics
 *  - Structured error handling via ApiError / ApiErrorCode
 *  - AbortController / cancellation support on every request
 *  - GraphQL query execution over the same transport
 *
 * Components and hooks import typed fetch helpers from here instead of
 * hand-assembling `fetch()` calls with their own header logic.
 *
 * Issue #1039 — Add typed API client boundary
 */

// ─── Error codes ──────────────────────────────────────────────────────────────

/**
 * Machine-readable codes for every failure mode the client surfaces.
 *
 * These are stable across releases — do not remove or rename existing values.
 */
export const ApiErrorCode = {
  /** Network-level failure: DNS, TCP, fetch itself threw */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** The request was explicitly cancelled via AbortSignal */
  CANCELLED: 'CANCELLED',
  /** Server returned HTTP 400 */
  BAD_REQUEST: 'BAD_REQUEST',
  /** Server returned HTTP 401 */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Server returned HTTP 403 */
  FORBIDDEN: 'FORBIDDEN',
  /** Server returned HTTP 404 */
  NOT_FOUND: 'NOT_FOUND',
  /** Server returned HTTP 409 */
  CONFLICT: 'CONFLICT',
  /** Server returned HTTP 422 */
  UNPROCESSABLE: 'UNPROCESSABLE',
  /** Server returned HTTP 429 — caller may apply back-off */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Server returned HTTP 5xx */
  SERVER_ERROR: 'SERVER_ERROR',
  /** Response body was not valid JSON or did not match the expected shape */
  PARSE_ERROR: 'PARSE_ERROR',
  /** GraphQL response contained a non-empty `errors` array */
  GRAPHQL_ERROR: 'GRAPHQL_ERROR',
  /** Catch-all for anything else */
  UNKNOWN: 'UNKNOWN',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

// ─── ApiError ─────────────────────────────────────────────────────────────────

/**
 * Structured error thrown (or returned) by every method on `ApiClient`.
 *
 * Always has:
 *  - `code`    — stable machine-readable enum value
 *  - `message` — human-readable description safe to show in UI
 *
 * Optionally carries:
 *  - `status`   — HTTP status code (absent for network/cancel errors)
 *  - `body`     — raw response text for debugging (never log in production)
 *  - `graphqlErrors` — array of GraphQL error objects when `code === GRAPHQL_ERROR`
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly body?: string;
  readonly graphqlErrors?: GraphQlError[];

  constructor(
    code: ApiErrorCode,
    message: string,
    opts?: { status?: number; body?: string; graphqlErrors?: GraphQlError[] },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = opts?.status;
    this.body = opts?.body;
    this.graphqlErrors = opts?.graphqlErrors;
    // Restore prototype chain in transpiled environments.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Type guard: true when `err` is an `ApiError`. */
export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Map an HTTP status code to its canonical ApiErrorCode.
 */
function statusToCode(status: number): ApiErrorCode {
  if (status === 400) return ApiErrorCode.BAD_REQUEST;
  if (status === 401) return ApiErrorCode.UNAUTHORIZED;
  if (status === 403) return ApiErrorCode.FORBIDDEN;
  if (status === 404) return ApiErrorCode.NOT_FOUND;
  if (status === 409) return ApiErrorCode.CONFLICT;
  if (status === 422) return ApiErrorCode.UNPROCESSABLE;
  if (status === 429) return ApiErrorCode.RATE_LIMITED;
  if (status >= 500) return ApiErrorCode.SERVER_ERROR;
  return ApiErrorCode.UNKNOWN;
}

/**
 * Extract a message from an unknown error (avoids `any`).
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'An unexpected error occurred';
}

// ─── Response shape helpers ────────────────────────────────────────────────────

/**
 * Generic API envelope returned by the SorobanPay backend.
 *
 * All REST endpoints wrap their payload in `{ data: T }`.  Error responses
 * wrap their detail in `{ error: { code, message } }`.  Both shapes are
 * handled by `ApiClient` before callers receive a value.
 */
export interface ApiEnvelope<T> {
  data: T;
}

/** Error body returned by the backend on non-2xx responses. */
export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
}

// ─── GraphQL types ─────────────────────────────────────────────────────────────

export interface GraphQlError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface GraphQlResponse<T> {
  data?: T;
  errors?: GraphQlError[];
}

// ─── Request options ───────────────────────────────────────────────────────────

/**
 * Options accepted by every request method.
 *
 * `signal` is the standard AbortSignal — pass one from an `AbortController`
 * to cancel the request (e.g. on component unmount).
 */
export interface RequestOptions {
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Additional headers merged on top of the defaults. */
  headers?: Record<string, string>;
  /**
   * Whether to wrap the response body in an envelope check.
   * Default: true (expect `{ data: T }`).
   * Set to false for endpoints that return the payload directly.
   */
  unwrapEnvelope?: boolean;
}

// ─── ApiClient ────────────────────────────────────────────────────────────────

/**
 * Options for constructing an `ApiClient` instance.
 */
export interface ApiClientOptions {
  /**
   * Base URL for the backend REST / GraphQL API.
   * Should NOT end with a slash.
   * @example "https://api.sorobanpay.example.com"
   */
  baseUrl: string;

  /**
   * Bearer token added to every request as `Authorization: Bearer <token>`.
   * Omit for unauthenticated (public) endpoints.
   * Sensitive — never log this value.
   */
  authToken?: string;

  /**
   * Connected wallet public key forwarded as `X-Wallet-Public-Key`.
   * Used by the backend to scope read queries to the caller's address.
   * Safe to include in headers (it is a public address).
   */
  walletPublicKey?: string;

  /**
   * Stellar network name forwarded as `X-Stellar-Network`.
   * Allows the backend to enforce network-specific validation.
   * @example "testnet" | "mainnet"
   */
  network?: string;

  /**
   * Default `fetch` implementation — injectable for testing.
   * Defaults to the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Typed API client.
 *
 * All methods return `Promise<T>` and throw `ApiError` on any failure.
 * Use `isApiError(err)` to narrow caught errors.
 *
 * @example
 * ```ts
 * const client = createApiClient({ baseUrl: 'https://api.sorobanpay.example.com' });
 *
 * // GET /subscriptions?subscriber=G...
 * const subs = await client.get<Subscription[]>('/subscriptions', {
 *   params: { subscriber: publicKey },
 * });
 *
 * // POST /subscriptions
 * const created = await client.post<Subscription>('/subscriptions', { body: payload });
 *
 * // Cancellation
 * const controller = new AbortController();
 * const data = await client.get<Report>('/reports', { signal: controller.signal });
 * controller.abort(); // cancels the in-flight request
 * ```
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly authToken: string | undefined;
  private readonly walletPublicKey: string | undefined;
  private readonly network: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    // Strip trailing slash once at construction time.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.authToken = opts.authToken;
    this.walletPublicKey = opts.walletPublicKey;
    this.network = opts.network;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  // ── Default headers ──────────────────────────────────────────────────────

  /**
   * Build the default header set for every request.
   *
   * Callers can merge additional per-request headers via `opts.headers`.
   * The `Authorization` header is only included when `authToken` is set.
   */
  private defaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.authToken) {
      // Never log the token value in production.
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    if (this.walletPublicKey) {
      headers['X-Wallet-Public-Key'] = this.walletPublicKey;
    }

    if (this.network) {
      headers['X-Stellar-Network'] = this.network;
    }

    return headers;
  }

  // ── Core request ──────────────────────────────────────────────────────────

  /**
   * Execute an HTTP request and return the parsed response body.
   *
   * @param method  HTTP verb.
   * @param path    Path relative to `baseUrl`, must start with `/`.
   * @param body    Optional request body serialized as JSON.
   * @param opts    Per-request options (signal, extra headers, envelope flag).
   */
  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const mergedHeaders: Record<string, string> = {
      ...this.defaultHeaders(),
      ...(opts.headers ?? {}),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: mergedHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: opts.signal,
      });
    } catch (err: unknown) {
      // Distinguish cancellation from other network errors.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(ApiErrorCode.CANCELLED, 'Request was cancelled');
      }
      throw new ApiError(
        ApiErrorCode.NETWORK_ERROR,
        `Network request failed: ${errorMessage(err)}`,
      );
    }

    // Parse the response body regardless of status (error bodies carry detail).
    let rawText: string;
    try {
      rawText = await response.text();
    } catch {
      rawText = '';
    }

    if (!response.ok) {
      const code = statusToCode(response.status);
      // Try to extract a message from a JSON error body.
      let detail = `HTTP ${response.status}`;
      try {
        const errorBody = JSON.parse(rawText) as ApiErrorBody;
        detail =
          errorBody?.error?.message ??
          errorBody?.message ??
          detail;
      } catch {
        // rawText is not JSON; use the status line.
      }
      throw new ApiError(code, detail, { status: response.status, body: rawText });
    }

    // Parse JSON body.
    let parsed: unknown;
    try {
      parsed = rawText.length > 0 ? (JSON.parse(rawText) as unknown) : undefined;
    } catch {
      throw new ApiError(
        ApiErrorCode.PARSE_ERROR,
        'Response body is not valid JSON',
        { status: response.status, body: rawText },
      );
    }

    // Unwrap envelope `{ data: T }` by default.
    const unwrap = opts.unwrapEnvelope ?? true;
    if (unwrap) {
      const envelope = parsed as ApiEnvelope<T>;
      if (
        parsed === null ||
        parsed === undefined ||
        typeof parsed !== 'object' ||
        !('data' in (parsed as object))
      ) {
        throw new ApiError(
          ApiErrorCode.PARSE_ERROR,
          'Response did not contain expected "data" envelope',
          { status: response.status, body: rawText },
        );
      }
      return envelope.data;
    }

    return parsed as T;
  }

  // ── Public HTTP methods ───────────────────────────────────────────────────

  /**
   * HTTP GET.
   *
   * Query parameters should be encoded into `path` before calling.
   * Example: `/subscriptions?subscriber=${encodeURIComponent(pk)}`
   */
  async get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  /**
   * HTTP POST.
   *
   * `body` is serialized to JSON.
   */
  async post<T>(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  /**
   * HTTP PUT.
   *
   * `body` is serialized to JSON.
   */
  async put<T>(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, opts);
  }

  /**
   * HTTP PATCH.
   *
   * `body` is serialized to JSON.
   */
  async patch<T>(
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('PATCH', path, body, opts);
  }

  /**
   * HTTP DELETE.
   */
  async delete<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  // ── GraphQL ───────────────────────────────────────────────────────────────

  /**
   * Execute a GraphQL query or mutation over HTTP POST.
   *
   * The endpoint defaults to `/graphql` unless overridden in `path`.
   *
   * Throws `ApiError` with code `GRAPHQL_ERROR` if the response's `errors`
   * array is non-empty, even when the HTTP status is 200.
   *
   * @example
   * ```ts
   * const { merchant } = await client.graphql<{ merchant: MerchantData }>(
   *   `query GetMerchant($id: ID!) { merchant(id: $id) { id name } }`,
   *   { variables: { id: merchantId } },
   * );
   * ```
   */
  async graphql<T>(
    query: string,
    opts?: { variables?: Record<string, unknown>; signal?: AbortSignal; path?: string },
  ): Promise<T> {
    const path = opts?.path ?? '/graphql';
    const body = { query, variables: opts?.variables };

    // GraphQL responses always use `{ data, errors }` not `{ data: { data } }`,
    // so disable envelope unwrapping and parse the GraphQL shape manually.
    const raw = await this.request<GraphQlResponse<T>>(
      'POST',
      path,
      body,
      { signal: opts?.signal, unwrapEnvelope: false },
    );

    if (raw.errors && raw.errors.length > 0) {
      throw new ApiError(
        ApiErrorCode.GRAPHQL_ERROR,
        raw.errors.map((e) => e.message).join('; '),
        { graphqlErrors: raw.errors },
      );
    }

    if (raw.data === undefined) {
      throw new ApiError(
        ApiErrorCode.PARSE_ERROR,
        'GraphQL response contained no "data" field',
      );
    }

    return raw.data;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an `ApiClient` configured from the provided options.
 *
 * In application code you will typically call this once and share the
 * instance (or create one per hook invocation with per-request options).
 *
 * @example
 * ```ts
 * import { createApiClient } from '@/lib/api_client';
 *
 * const client = createApiClient({
 *   baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
 *   walletPublicKey: publicKey ?? undefined,
 *   network: getNetworkConfig().name.toLowerCase(),
 * });
 * ```
 */
export function createApiClient(opts: ApiClientOptions): ApiClient {
  return new ApiClient(opts);
}

// ─── Singleton helpers ────────────────────────────────────────────────────────

let _defaultClient: ApiClient | null = null;

/**
 * Return the default shared `ApiClient` instance.
 *
 * Constructed lazily from `NEXT_PUBLIC_API_BASE_URL`. If no base URL is
 * configured the client uses an empty string, which means relative paths
 * (useful for Next.js API routes).
 *
 * Override the singleton in tests by calling `setDefaultApiClient(mock)`.
 */
export function getDefaultApiClient(): ApiClient {
  if (!_defaultClient) {
    _defaultClient = new ApiClient({
      baseUrl: (typeof process !== 'undefined'
        ? process.env.NEXT_PUBLIC_API_BASE_URL
        : undefined) ?? '',
    });
  }
  return _defaultClient;
}

/**
 * Replace the default shared client — intended for tests and Storybook.
 *
 * Pass `null` to reset to the lazily-constructed default.
 */
export function setDefaultApiClient(client: ApiClient | null): void {
  _defaultClient = client;
}
