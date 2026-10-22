/**
 * api_version.ts
 *
 * API version negotiation for SorobanPay.
 *
 * Responsibilities
 * ────────────────
 * 1. Declare which API versions this client supports (SUPPORTED_API_VERSIONS).
 * 2. Build a version-negotiation request header / metadata object to attach
 *    to outbound requests so servers can choose the best version.
 * 3. Parse the server's version response and decide whether the client can
 *    proceed, should warn, or must surface an upgrade message.
 * 4. Provide a human-readable upgrade message when the server requires a
 *    version the client does not support.
 *
 * Design principles
 * ─────────────────
 * • Pure functions — no side effects, no network calls.
 * • The negotiation result is a discriminated union so callers must handle
 *   every outcome explicitly (compatible / upgrade_required / unknown).
 * • Sensitive values (keys, tokens, credentials) are never included in
 *   negotiation metadata.
 * • All exported types are stable — adding a new supported version is a
 *   backwards-compatible change.
 *
 * Issue #1053 – Add API version negotiation
 */

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Ordered list of API versions this client supports, newest first.
 * When a server advertises multiple versions, the first match wins.
 */
export const SUPPORTED_API_VERSIONS = ['2', '1'] as const;

/** The preferred (highest) API version this client wants to use. */
export const PREFERRED_API_VERSION: string =
  SUPPORTED_API_VERSIONS[0];

/** Header name sent with every request to advertise client capabilities. */
export const API_VERSION_HEADER = 'X-SorobanPay-API-Version';

/** Header name read from server responses that carries the negotiated version. */
export const API_VERSION_RESPONSE_HEADER = 'X-SorobanPay-API-Version';

/**
 * Upgrade docs URL embedded in incompatibility messages.
 * Replace with a real URL before deploying to production.
 */
export const UPGRADE_DOCS_URL =
  'https://github.com/Chrisland58/SorobanPay/blob/main/docs/api-cookbook.md';

// ── Types ────────────────────────────────────────────────────────────────────

/** Metadata attached to outbound API requests for version negotiation. */
export interface ApiVersionRequest {
  /** Preferred API version (highest supported). */
  preferredVersion: string;
  /** All API versions this client can handle, ordered newest → oldest. */
  supportedVersions: readonly string[];
  /** Header map to merge into fetch/XHR request headers. */
  headers: Record<string, string>;
}

/** Outcome when the server and client share at least one common version. */
export interface NegotiationCompatible {
  status: 'compatible';
  /** The agreed-upon version that both sides support. */
  negotiatedVersion: string;
  /** True when the negotiated version is not the client's preferred version. */
  isDowngraded: boolean;
}

/** Outcome when no common version exists — the client must upgrade. */
export interface NegotiationUpgradeRequired {
  status: 'upgrade_required';
  /** The minimum version the server requires. */
  serverVersion: string;
  /** Human-readable message to surface in the UI. */
  upgradeMessage: string;
}

/** Outcome when the server response carries no parseable version info. */
export interface NegotiationUnknown {
  status: 'unknown';
  /** Explanation of why negotiation could not complete. */
  reason: string;
}

export type NegotiationResult =
  | NegotiationCompatible
  | NegotiationUpgradeRequired
  | NegotiationUnknown;

/** Shape of a server's version advertisement (from a JSON response body or header). */
export interface ServerVersionAdvertisement {
  /**
   * Single version string (e.g. "2") or an array of versions the server supports
   * (e.g. ["2", "1"]), ordered newest → oldest.
   */
  version: string | string[];
  /**
   * Optional minimum version the server will accept. When present and the client
   * cannot satisfy it, the result is upgrade_required.
   */
  minVersion?: string;
  /** Optional human-readable message from the server (e.g. deprecation notice). */
  serverMessage?: string;
}

// ── Request metadata ──────────────────────────────────────────────────────────

/**
 * Build the API version metadata to attach to an outbound request.
 *
 * Returns an object with:
 *   - `preferredVersion`: the version the client would like to use
 *   - `supportedVersions`: all versions the client can handle
 *   - `headers`: a header map ready to spread into `fetch` init.headers
 *
 * @example
 *   const meta = buildVersionRequest();
 *   const response = await fetch(url, {
 *     headers: { ...meta.headers, 'Content-Type': 'application/json' },
 *   });
 */
export function buildVersionRequest(): ApiVersionRequest {
  return {
    preferredVersion: PREFERRED_API_VERSION,
    supportedVersions: SUPPORTED_API_VERSIONS,
    headers: {
      [API_VERSION_HEADER]: PREFERRED_API_VERSION,
      'X-SorobanPay-Supported-Versions': SUPPORTED_API_VERSIONS.join(','),
    },
  };
}

// ── Negotiation ───────────────────────────────────────────────────────────────

/**
 * Negotiate an API version given a server advertisement.
 *
 * Algorithm:
 *   1. Normalise the server version list.
 *   2. If the server advertises a `minVersion` and the client cannot satisfy it,
 *      return upgrade_required immediately.
 *   3. Find the highest client-supported version that the server also supports.
 *   4. If a match is found → compatible (with `isDowngraded` flag).
 *   5. If no match is found → upgrade_required.
 *
 * @param advertisement  Server version advertisement (from response body / header).
 * @returns              NegotiationResult discriminated union.
 */
export function negotiateVersion(
  advertisement: ServerVersionAdvertisement,
): NegotiationResult {
  const serverVersions = normaliseVersionList(advertisement.version);

  if (serverVersions.length === 0) {
    return {
      status: 'unknown',
      reason:
        'Server version advertisement is empty or could not be parsed.',
    };
  }

  // Step 1: enforce minVersion if the server declares one
  if (advertisement.minVersion != null) {
    const minVer = advertisement.minVersion.trim();
    if (minVer !== '' && !clientSupports(minVer)) {
      return {
        status: 'upgrade_required',
        serverVersion: minVer,
        upgradeMessage: buildUpgradeMessage(minVer, advertisement.serverMessage),
      };
    }
  }

  // Step 2: find the best common version (client preference takes priority)
  for (const clientVer of SUPPORTED_API_VERSIONS) {
    if (serverVersions.includes(clientVer)) {
      return {
        status: 'compatible',
        negotiatedVersion: clientVer,
        isDowngraded: clientVer !== PREFERRED_API_VERSION,
      };
    }
  }

  // Step 3: no overlap — pick the highest server version for the error message
  const highestServer = serverVersions[0];
  return {
    status: 'upgrade_required',
    serverVersion: highestServer,
    upgradeMessage: buildUpgradeMessage(highestServer, advertisement.serverMessage),
  };
}

/**
 * Parse a version string from a raw HTTP response header value and negotiate.
 *
 * The header value is expected to be a comma-separated list of versions
 * (e.g. "2,1") or a single version (e.g. "2").
 *
 * Returns unknown if the header is absent, empty, or unparseable.
 *
 * @param headerValue  Raw value of the API_VERSION_RESPONSE_HEADER header.
 * @returns            NegotiationResult.
 */
export function negotiateFromHeader(
  headerValue: string | null | undefined,
): NegotiationResult {
  if (!headerValue || headerValue.trim() === '') {
    return {
      status: 'unknown',
      reason:
        `No ${API_VERSION_RESPONSE_HEADER} header present in the server response.`,
    };
  }

  const versions = headerValue
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  if (versions.length === 0) {
    return {
      status: 'unknown',
      reason: 'Server version header was present but contained no parseable versions.',
    };
  }

  return negotiateVersion({ version: versions });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * True if `version` appears in SUPPORTED_API_VERSIONS.
 */
export function clientSupports(version: string): boolean {
  return (SUPPORTED_API_VERSIONS as readonly string[]).includes(version);
}

/**
 * True when the negotiation result indicates the client and server
 * share a compatible version.
 */
export function isCompatible(result: NegotiationResult): result is NegotiationCompatible {
  return result.status === 'compatible';
}

/**
 * True when the negotiation result requires the client to upgrade.
 */
export function isUpgradeRequired(
  result: NegotiationResult,
): result is NegotiationUpgradeRequired {
  return result.status === 'upgrade_required';
}

/**
 * Build a user-facing upgrade message for display in the UI.
 *
 * Keeps the message concise and actionable. Does not include any sensitive
 * values — the server message is passed through verbatim only when present,
 * so callers should sanitise it before rendering if server trust is limited.
 */
export function buildUpgradeMessage(
  requiredVersion: string,
  serverMessage?: string,
): string {
  const base =
    `This version of SorobanPay requires API version ${requiredVersion} or higher, ` +
    `but your client only supports versions ${SUPPORTED_API_VERSIONS.join(', ')}. ` +
    `Please upgrade to continue. See ${UPGRADE_DOCS_URL} for details.`;

  if (serverMessage && serverMessage.trim() !== '') {
    return `${base} Server says: ${serverMessage.trim()}`;
  }

  return base;
}

/**
 * Normalise a `version` field (string or string[]) to a deduplicated string[].
 */
function normaliseVersionList(version: string | string[]): string[] {
  const raw: string[] = Array.isArray(version) ? version : [version];
  const seen = new Set<string>();
  return raw
    .map((v) => v.trim())
    .filter((v) => {
      if (v === '' || seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}
