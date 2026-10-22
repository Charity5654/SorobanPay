/**
 * api_version.test.ts
 *
 * Unit tests for the API version negotiation module.
 *
 * Covers:
 *   - buildVersionRequest: shape, headers, supported versions list
 *   - negotiateVersion: compatible, downgraded, upgrade_required, unknown
 *   - negotiateFromHeader: header parsing, missing header, empty header
 *   - buildUpgradeMessage: content, docs URL, optional server message
 *   - clientSupports: known and unknown versions
 *   - isCompatible / isUpgradeRequired: type-guard helpers
 *   - Wallet / network safety: no sensitive values in negotiation metadata
 *
 * Issue #1053 – Add API version negotiation
 */

import {
  buildVersionRequest,
  negotiateVersion,
  negotiateFromHeader,
  buildUpgradeMessage,
  clientSupports,
  isCompatible,
  isUpgradeRequired,
  SUPPORTED_API_VERSIONS,
  PREFERRED_API_VERSION,
  API_VERSION_HEADER,
  UPGRADE_DOCS_URL,
  type ServerVersionAdvertisement,
  type NegotiationResult,
} from '@/lib/api_version';

// ── buildVersionRequest ───────────────────────────────────────────────────────

describe('buildVersionRequest', () => {
  it('returns preferredVersion equal to the highest supported version', () => {
    const req = buildVersionRequest();
    expect(req.preferredVersion).toBe(PREFERRED_API_VERSION);
    expect(req.preferredVersion).toBe(SUPPORTED_API_VERSIONS[0]);
  });

  it('returns all supported versions in order', () => {
    const req = buildVersionRequest();
    expect(req.supportedVersions).toEqual(SUPPORTED_API_VERSIONS);
  });

  it('includes the API version header', () => {
    const req = buildVersionRequest();
    expect(req.headers[API_VERSION_HEADER]).toBe(PREFERRED_API_VERSION);
  });

  it('includes the supported versions header', () => {
    const req = buildVersionRequest();
    const headerValue = req.headers['X-SorobanPay-Supported-Versions'];
    expect(headerValue).toBeDefined();
    // Must list all supported versions
    for (const v of SUPPORTED_API_VERSIONS) {
      expect(headerValue).toContain(v);
    }
  });

  it('headers object contains no sensitive keys', () => {
    const req = buildVersionRequest();
    const headerKeys = Object.keys(req.headers).map((k) => k.toLowerCase());
    const sensitivePatterns = [
      'privatekey', 'mnemonic', 'secret', 'password', 'seed', 'credential',
    ];
    for (const pattern of sensitivePatterns) {
      expect(headerKeys.some((k) => k.includes(pattern))).toBe(false);
    }
  });
});

// ── negotiateVersion: compatible ──────────────────────────────────────────────

describe('negotiateVersion — compatible', () => {
  it('returns compatible when server supports the preferred version', () => {
    const ad: ServerVersionAdvertisement = { version: PREFERRED_API_VERSION };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('compatible');
    if (result.status === 'compatible') {
      expect(result.negotiatedVersion).toBe(PREFERRED_API_VERSION);
      expect(result.isDowngraded).toBe(false);
    }
  });

  it('returns compatible when server lists multiple versions including preferred', () => {
    const ad: ServerVersionAdvertisement = {
      version: [PREFERRED_API_VERSION, '1', '0'],
    };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('compatible');
    if (result.status === 'compatible') {
      expect(result.negotiatedVersion).toBe(PREFERRED_API_VERSION);
      expect(result.isDowngraded).toBe(false);
    }
  });

  it('returns compatible with isDowngraded=true when only an older version matches', () => {
    // Server only supports v1 (not preferred v2)
    const ad: ServerVersionAdvertisement = { version: ['1'] };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('compatible');
    if (result.status === 'compatible') {
      expect(result.negotiatedVersion).toBe('1');
      expect(result.isDowngraded).toBe(true);
    }
  });

  it('chooses the highest common version when server lists older ones first', () => {
    const ad: ServerVersionAdvertisement = {
      version: ['1', PREFERRED_API_VERSION],
    };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('compatible');
    if (result.status === 'compatible') {
      expect(result.negotiatedVersion).toBe(PREFERRED_API_VERSION);
      expect(result.isDowngraded).toBe(false);
    }
  });

  it('satisfies minVersion when client already meets it', () => {
    const ad: ServerVersionAdvertisement = {
      version: PREFERRED_API_VERSION,
      minVersion: '1', // client supports v1 and v2 — fine
    };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('compatible');
  });
});

// ── negotiateVersion: upgrade_required ────────────────────────────────────────

describe('negotiateVersion — upgrade_required', () => {
  it('returns upgrade_required when server version list has no overlap', () => {
    const ad: ServerVersionAdvertisement = { version: ['99', '50'] };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('upgrade_required');
    if (result.status === 'upgrade_required') {
      expect(result.serverVersion).toBe('99');
      expect(result.upgradeMessage).toBeTruthy();
    }
  });

  it('returns upgrade_required when minVersion is not in client supported list', () => {
    const ad: ServerVersionAdvertisement = {
      version: ['99'],
      minVersion: '99',
    };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('upgrade_required');
    if (result.status === 'upgrade_required') {
      expect(result.serverVersion).toBe('99');
    }
  });

  it('includes upgradeMessage mentioning the required version', () => {
    const ad: ServerVersionAdvertisement = { version: ['5'] };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('upgrade_required');
    if (result.status === 'upgrade_required') {
      expect(result.upgradeMessage).toContain('5');
    }
  });

  it('passes server message through to upgrade message when present', () => {
    const ad: ServerVersionAdvertisement = {
      version: ['5'],
      serverMessage: 'Please update your client immediately.',
    };
    const result = negotiateVersion(ad);
    if (result.status === 'upgrade_required') {
      expect(result.upgradeMessage).toContain('Please update your client immediately.');
    }
  });

  it('minVersion check takes priority before version overlap check', () => {
    // Server advertises v1 which client supports, BUT minVersion is v99 which
    // client does not support — should still fail.
    const ad: ServerVersionAdvertisement = {
      version: ['1'],
      minVersion: '99',
    };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('upgrade_required');
    if (result.status === 'upgrade_required') {
      expect(result.serverVersion).toBe('99');
    }
  });
});

// ── negotiateVersion: unknown ─────────────────────────────────────────────────

describe('negotiateVersion — unknown', () => {
  it('returns unknown when version list is an empty array', () => {
    const ad: ServerVersionAdvertisement = { version: [] };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.reason).toBeTruthy();
    }
  });

  it('returns unknown when version list contains only whitespace strings', () => {
    const ad: ServerVersionAdvertisement = { version: ['   ', ''] };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('unknown');
  });

  it('returns unknown when version is an empty string', () => {
    const ad: ServerVersionAdvertisement = { version: '' };
    const result = negotiateVersion(ad);
    expect(result.status).toBe('unknown');
  });
});

// ── negotiateFromHeader ───────────────────────────────────────────────────────

describe('negotiateFromHeader', () => {
  it('negotiates from a single-version header', () => {
    const result = negotiateFromHeader(PREFERRED_API_VERSION);
    expect(result.status).toBe('compatible');
  });

  it('negotiates from a comma-separated multi-version header', () => {
    const result = negotiateFromHeader(
      `${PREFERRED_API_VERSION},1`,
    );
    expect(result.status).toBe('compatible');
    if (result.status === 'compatible') {
      expect(result.negotiatedVersion).toBe(PREFERRED_API_VERSION);
    }
  });

  it('handles extra whitespace around version tokens', () => {
    const result = negotiateFromHeader(` ${PREFERRED_API_VERSION} , 1 `);
    expect(result.status).toBe('compatible');
  });

  it('returns unknown for null header', () => {
    const result = negotiateFromHeader(null);
    expect(result.status).toBe('unknown');
    if (result.status === 'unknown') {
      expect(result.reason).toBeTruthy();
    }
  });

  it('returns unknown for undefined header', () => {
    const result = negotiateFromHeader(undefined);
    expect(result.status).toBe('unknown');
  });

  it('returns unknown for empty string header', () => {
    const result = negotiateFromHeader('');
    expect(result.status).toBe('unknown');
  });

  it('returns unknown for whitespace-only header', () => {
    const result = negotiateFromHeader('   ');
    expect(result.status).toBe('unknown');
  });

  it('returns upgrade_required when server header lists unsupported version only', () => {
    const result = negotiateFromHeader('99');
    expect(result.status).toBe('upgrade_required');
  });
});

// ── buildUpgradeMessage ───────────────────────────────────────────────────────

describe('buildUpgradeMessage', () => {
  it('includes the required version in the message', () => {
    const msg = buildUpgradeMessage('3');
    expect(msg).toContain('3');
  });

  it('includes the docs URL', () => {
    const msg = buildUpgradeMessage('3');
    expect(msg).toContain(UPGRADE_DOCS_URL);
  });

  it('lists all supported versions in the message', () => {
    const msg = buildUpgradeMessage('3');
    for (const v of SUPPORTED_API_VERSIONS) {
      expect(msg).toContain(v);
    }
  });

  it('appends the server message when provided', () => {
    const msg = buildUpgradeMessage('3', 'Scheduled maintenance complete.');
    expect(msg).toContain('Scheduled maintenance complete.');
  });

  it('does not append server message when it is empty', () => {
    const withMsg = buildUpgradeMessage('3', 'Server says: contact support.');
    const withoutMsg = buildUpgradeMessage('3', '');
    expect(withMsg.length).toBeGreaterThan(withoutMsg.length);
  });

  it('does not append server message when it is whitespace only', () => {
    const msg = buildUpgradeMessage('3', '   ');
    expect(msg).not.toContain('Server says:');
  });

  it('never includes sensitive words in the upgrade message', () => {
    const msg = buildUpgradeMessage('3', 'normal notice');
    const sensitivePatterns = ['privatekey', 'mnemonic', 'secret', 'password', 'seed'];
    for (const pattern of sensitivePatterns) {
      expect(msg.toLowerCase()).not.toContain(pattern);
    }
  });
});

// ── clientSupports ────────────────────────────────────────────────────────────

describe('clientSupports', () => {
  it('returns true for all supported versions', () => {
    for (const v of SUPPORTED_API_VERSIONS) {
      expect(clientSupports(v)).toBe(true);
    }
  });

  it('returns false for an unsupported version', () => {
    expect(clientSupports('0')).toBe(false);
    expect(clientSupports('99')).toBe(false);
    expect(clientSupports('')).toBe(false);
  });
});

// ── isCompatible / isUpgradeRequired ─────────────────────────────────────────

describe('type-guard helpers', () => {
  it('isCompatible returns true for a compatible result', () => {
    const result: NegotiationResult = {
      status: 'compatible',
      negotiatedVersion: '2',
      isDowngraded: false,
    };
    expect(isCompatible(result)).toBe(true);
    expect(isUpgradeRequired(result)).toBe(false);
  });

  it('isUpgradeRequired returns true for an upgrade_required result', () => {
    const result: NegotiationResult = {
      status: 'upgrade_required',
      serverVersion: '5',
      upgradeMessage: 'Please upgrade.',
    };
    expect(isUpgradeRequired(result)).toBe(true);
    expect(isCompatible(result)).toBe(false);
  });

  it('neither guard returns true for an unknown result', () => {
    const result: NegotiationResult = {
      status: 'unknown',
      reason: 'No header present.',
    };
    expect(isCompatible(result)).toBe(false);
    expect(isUpgradeRequired(result)).toBe(false);
  });
});

// ── Loading / cancellation (async-safety) ────────────────────────────────────

describe('loading and cancellation safety', () => {
  it('buildVersionRequest is synchronous and never throws', () => {
    expect(() => buildVersionRequest()).not.toThrow();
  });

  it('negotiateVersion is synchronous and never throws for any input', () => {
    const weirdInputs: Array<Record<string, unknown>> = [
      {},
      { version: null },
      { version: 123 },
      { version: ['2'], minVersion: null },
      { version: ['2'], serverMessage: null },
    ];
    for (const input of weirdInputs) {
      expect(() =>
        negotiateVersion(input as unknown as ServerVersionAdvertisement),
      ).not.toThrow();
    }
  });

  it('negotiateFromHeader is synchronous and never throws', () => {
    const inputs = [null, undefined, '', '   ', 'garbage', '2,1', '99'];
    for (const input of inputs) {
      expect(() => negotiateFromHeader(input)).not.toThrow();
    }
  });
});

// ── Accessibility: messages are human-readable ────────────────────────────────

describe('upgrade message accessibility', () => {
  it('upgrade message is a non-empty plain string', () => {
    const result = negotiateVersion({ version: ['99'] });
    if (result.status === 'upgrade_required') {
      expect(typeof result.upgradeMessage).toBe('string');
      expect(result.upgradeMessage.length).toBeGreaterThan(0);
    }
  });

  it('unknown reason is a non-empty plain string', () => {
    const result = negotiateFromHeader(null);
    if (result.status === 'unknown') {
      expect(typeof result.reason).toBe('string');
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
