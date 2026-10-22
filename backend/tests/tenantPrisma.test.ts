/**
 * tenantPrisma.test.ts — #1061
 *
 * Unit tests for the TenantPrismaClient wrapper and withTenant factory.
 *
 * Prisma is mocked so no real database is required.
 * All tests verify that the tenant filter is correctly injected, that caller
 * where-clauses are merged (not replaced), and that tenant isolation holds
 * across separate instances.
 */

// ─── Prisma mock ──────────────────────────────────────────────────────────────
//
// Each model delegate method is a jest.fn() that we can inspect to verify
// the exact arguments passed by TenantPrismaClient.

const mockEventDelegate = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
};

const mockSubscriptionDelegate = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
};

const mockPaymentDelegate = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
};

const mockWebhookEndpointDelegate = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
};

const mockWebhookDeliveryDelegate = {
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  count: jest.fn().mockResolvedValue(0),
};

const mockPrismaTransaction = jest.fn().mockResolvedValue([]);

jest.mock('../src/lib/prisma', () => {
  // We must re-export the actual module logic while swapping prisma internals.
  // Since TenantPrismaClient references the module-level `prisma` singleton,
  // we replace the mock's default export with an object whose delegates are
  // the spy functions above, then re-export the real class/factory via the
  // actual module (loaded after this factory runs).
  const actual = jest.requireActual('../src/lib/prisma');

  const mockPrisma = {
    event: mockEventDelegate,
    subscription: mockSubscriptionDelegate,
    payment: mockPaymentDelegate,
    webhookEndpoint: mockWebhookEndpointDelegate,
    webhookDelivery: mockWebhookDeliveryDelegate,
    $transaction: mockPrismaTransaction,
  };

  // Rebuild TenantPrismaClient using the mock prisma, by monkey-patching
  // the module's default export before the class reads it.
  // We expose the real withTenant and TenantPrismaClient from the actual module
  // so our tests exercise the real code paths.
  return {
    __esModule: true,
    default: mockPrisma,
    withTenant: actual.withTenant,
    TenantPrismaClient: actual.TenantPrismaClient,
  };
});

// ─── Import after mock registration ──────────────────────────────────────────

import { withTenant, TenantPrismaClient } from '../src/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_A = 'GMERCHANT_A_123456789ABCDEF';
const TENANT_B = 'GMERCHANT_B_987654321FEDCBA';

function clearMocks() {
  [
    mockEventDelegate,
    mockSubscriptionDelegate,
    mockPaymentDelegate,
    mockWebhookEndpointDelegate,
    mockWebhookDeliveryDelegate,
  ].forEach((delegate) => {
    Object.values(delegate).forEach((fn) => (fn as jest.Mock).mockClear());
  });
  mockPrismaTransaction.mockClear();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('withTenant factory', () => {
  afterEach(clearMocks);

  it('returns a TenantPrismaClient with the given tenantId', () => {
    const client = withTenant(TENANT_A);
    expect(client).toBeInstanceOf(TenantPrismaClient);
    expect(client.tenantId).toBe(TENANT_A);
  });

  it('throws when tenantId is empty string', () => {
    expect(() => withTenant('')).toThrow(/tenantId must be a non-empty string/i);
  });

  it('throws when tenantId is whitespace-only', () => {
    expect(() => withTenant('   ')).toThrow(/tenantId must be a non-empty string/i);
  });

  it('creates two independent clients with different tenantIds', () => {
    const clientA = withTenant(TENANT_A);
    const clientB = withTenant(TENANT_B);
    expect(clientA.tenantId).toBe(TENANT_A);
    expect(clientB.tenantId).toBe(TENANT_B);
  });
});

describe('TenantPrismaClient — events', () => {
  afterEach(clearMocks);

  it('injects merchant filter when no where clause is provided', async () => {
    const db = withTenant(TENANT_A);
    await db.events.findMany();
    expect(mockEventDelegate.findMany).toHaveBeenCalledWith({
      where: { merchant: TENANT_A },
    });
  });

  it('merges caller where clause with tenant merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.events.findMany({ where: { subscriber: 'GSUB123', type: 'executed' } });
    expect(mockEventDelegate.findMany).toHaveBeenCalledWith({
      where: { subscriber: 'GSUB123', type: 'executed', merchant: TENANT_A },
    });
  });

  it('passes through non-where args (orderBy, take, skip)', async () => {
    const db = withTenant(TENANT_A);
    await db.events.findMany({
      where: { type: 'subscribe' },
      orderBy: { ledgerTimestamp: 'desc' },
      take: 10,
    });
    expect(mockEventDelegate.findMany).toHaveBeenCalledWith({
      where: { type: 'subscribe', merchant: TENANT_A },
      orderBy: { ledgerTimestamp: 'desc' },
      take: 10,
    });
  });

  it('findFirst injects merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.events.findFirst({ where: { type: 'cancel' } });
    expect(mockEventDelegate.findFirst).toHaveBeenCalledWith({
      where: { type: 'cancel', merchant: TENANT_A },
    });
  });

  it('count injects merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.events.count();
    expect(mockEventDelegate.count).toHaveBeenCalledWith({
      where: { merchant: TENANT_A },
    });
  });
});

describe('TenantPrismaClient — subscriptions', () => {
  afterEach(clearMocks);

  it('merges status filter with tenant merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.subscriptions.findMany({ where: { status: 'ACTIVE' } });
    expect(mockSubscriptionDelegate.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE', merchant: TENANT_A },
    });
  });

  it('injects filter when no where clause provided', async () => {
    const db = withTenant(TENANT_A);
    await db.subscriptions.findMany();
    expect(mockSubscriptionDelegate.findMany).toHaveBeenCalledWith({
      where: { merchant: TENANT_A },
    });
  });
});

describe('TenantPrismaClient — tenant isolation', () => {
  afterEach(clearMocks);

  it('two clients with different tenants use their own tenant filter', async () => {
    const dbA = withTenant(TENANT_A);
    const dbB = withTenant(TENANT_B);

    await dbA.events.findMany();
    await dbB.events.findMany();

    const calls = mockEventDelegate.findMany.mock.calls;
    expect(calls[0][0]).toEqual({ where: { merchant: TENANT_A } });
    expect(calls[1][0]).toEqual({ where: { merchant: TENANT_B } });
  });

  it('tenant A queries do not affect tenant B results', async () => {
    mockEventDelegate.findMany
      .mockResolvedValueOnce([{ id: 1, merchant: TENANT_A }])
      .mockResolvedValueOnce([{ id: 2, merchant: TENANT_B }]);

    const dbA = withTenant(TENANT_A);
    const dbB = withTenant(TENANT_B);

    const [resA, resB] = await Promise.all([
      dbA.events.findMany(),
      dbB.events.findMany(),
    ]);

    expect((resA as { merchant: string }[])[0].merchant).toBe(TENANT_A);
    expect((resB as { merchant: string }[])[0].merchant).toBe(TENANT_B);
  });
});

describe('TenantPrismaClient — webhookEndpoints and webhookDeliveries', () => {
  afterEach(clearMocks);

  it('webhookEndpoints.findMany injects merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.webhookEndpoints.findMany({ where: { active: true } });
    expect(mockWebhookEndpointDelegate.findMany).toHaveBeenCalledWith({
      where: { active: true, merchant: TENANT_A },
    });
  });

  it('webhookDeliveries.count injects merchant filter', async () => {
    const db = withTenant(TENANT_A);
    await db.webhookDeliveries.count({ where: { success: false } });
    expect(mockWebhookDeliveryDelegate.count).toHaveBeenCalledWith({
      where: { success: false, merchant: TENANT_A },
    });
  });
});

describe('TenantPrismaClient — $transaction', () => {
  afterEach(clearMocks);

  it('delegates $transaction to the underlying prisma client', async () => {
    const db = withTenant(TENANT_A);
    const ops = [Promise.resolve(1), Promise.resolve(2)];
    // Cast to any to match overloaded signature
    await db.$transaction(ops as any);
    expect(mockPrismaTransaction).toHaveBeenCalledWith(ops, undefined);
  });
});
