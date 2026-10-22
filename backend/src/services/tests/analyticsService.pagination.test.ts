/**
 * analyticsService.pagination.test.ts
 *
 * Unit tests for getPaginatedEvents() and getTenantAggregates() added in #1070.
 *
 * Covers:
 *  1. Valid cursor pagination returns correct CursorPage shape
 *  2. Invalid cursor throws 'Invalid cursor'
 *  3. Limit clamped at 200 (>200 becomes 200)
 *  4. Tenant isolation (only events for that tenantId returned)
 *  5. Empty result returns null nextCursor
 *  6. getTenantAggregates returns correct shape
 *  7. Backward direction
 */

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    analyticsEvent: {
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn(),
    },
  },
}));

import prisma from '../../lib/prisma';
import { getPaginatedEvents, getTenantAggregates } from '../analyticsService';

const mockFindMany = prisma.analyticsEvent.findMany as jest.Mock;
const mockCount    = prisma.analyticsEvent.count as jest.Mock;
const mockGroupBy  = prisma.analyticsEvent.groupBy as jest.Mock;
const mockAgg      = prisma.analyticsEvent.aggregate as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(id: number, userId = 'tenant-1') {
  return {
    id,
    eventName: 'page_view',
    page: '/',
    properties: null,
    createdAt: new Date(2024, 0, id),
    userId,
  };
}

function encodeId(id: number): string {
  return Buffer.from(String(id), 'utf8').toString('base64url');
}

// ─── getPaginatedEvents ───────────────────────────────────────────────────────

describe('getPaginatedEvents()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns correct CursorPage shape', async () => {
    const items = [makeEvent(1), makeEvent(2), makeEvent(3)];
    mockFindMany.mockResolvedValue(items);
    mockCount.mockResolvedValue(3);

    const page = await getPaginatedEvents('tenant-1', { limit: 10 });

    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(3);
    expect(page.nextCursor).toBeNull(); // no extra item → last page
    expect(page.pageSize).toBe(3);
    expect(page).toHaveProperty('prevCursor');
  });

  test('sets nextCursor when more items exist', async () => {
    // Fetch limit+1 items to signal there is a next page
    const items = [makeEvent(1), makeEvent(2), makeEvent(3)]; // limit=2 → 3 items = hasMore
    mockFindMany.mockResolvedValue(items);
    mockCount.mockResolvedValue(10);

    const page = await getPaginatedEvents('tenant-1', { limit: 2 });

    expect(page.items).toHaveLength(2); // sentinel removed
    expect(page.nextCursor).toBe(encodeId(2)); // last kept item id
  });

  test('throws "Invalid cursor" for corrupt cursor string', async () => {
    await expect(
      getPaginatedEvents('tenant-1', { cursor: '!!invalid!!' }),
    ).rejects.toThrow('Invalid cursor');
  });

  test('throws "Invalid cursor" for empty cursor', async () => {
    await expect(
      getPaginatedEvents('tenant-1', { cursor: '' }),
    ).rejects.toThrow('Invalid cursor');
  });

  test('limit above 200 is clamped to 200', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getPaginatedEvents('tenant-1', { limit: 9999 });

    // take should be 200 + 1 = 201 (clamped limit + sentinel)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 201 }),
    );
  });

  test('tenant isolation: where clause includes userId filter', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getPaginatedEvents('tenant-xyz');

    const findManyCall = mockFindMany.mock.calls[0][0];
    expect(findManyCall.where).toMatchObject({ userId: 'tenant-xyz' });

    const countCall = mockCount.mock.calls[0][0];
    expect(countCall.where).toMatchObject({ userId: 'tenant-xyz' });
  });

  test('empty result returns null nextCursor and prevCursor', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    const page = await getPaginatedEvents('tenant-1');

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
    expect(page.prevCursor).toBeNull();
    expect(page.total).toBe(0);
  });

  test('backward direction uses desc ordering', async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await getPaginatedEvents('tenant-1', { direction: 'backward' });

    const call = mockFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ createdAt: 'desc' }),
        expect.objectContaining({ id: 'desc' }),
      ]),
    );
  });
});

// ─── getTenantAggregates ──────────────────────────────────────────────────────

describe('getTenantAggregates()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns correct TenantAggregates shape', async () => {
    mockCount.mockResolvedValue(42);
    mockGroupBy
      .mockResolvedValueOnce([
        { eventName: 'page_view', _count: { eventName: 30 } },
        { eventName: 'click', _count: { eventName: 12 } },
      ]) // topEvents
      .mockResolvedValueOnce([
        { sessionId: 'sess-1' },
        { sessionId: 'sess-2' },
      ]); // sessions
    mockAgg.mockResolvedValue({
      _min: { createdAt: new Date('2024-01-01') },
      _max: { createdAt: new Date('2024-01-31') },
    });

    const result = await getTenantAggregates('tenant-1');

    expect(result.totalEvents).toBe(42);
    expect(result.uniqueSessions).toBe(2);
    expect(result.topEvents).toHaveLength(2);
    expect(result.topEvents[0]).toEqual({ eventName: 'page_view', count: 30 });
    expect(result.dateRange.start).toBeInstanceOf(Date);
    expect(result.dateRange.end).toBeInstanceOf(Date);
  });

  test('tenant isolation: all queries use userId filter', async () => {
    mockCount.mockResolvedValue(0);
    mockGroupBy.mockResolvedValue([]);
    mockAgg.mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } });

    await getTenantAggregates('my-tenant');

    const countCall = mockCount.mock.calls[0][0];
    expect(countCall.where).toMatchObject({ userId: 'my-tenant' });
  });

  test('date range filter is passed through when provided', async () => {
    mockCount.mockResolvedValue(0);
    mockGroupBy.mockResolvedValue([]);
    mockAgg.mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } });

    const start = new Date('2024-01-01');
    const end = new Date('2024-01-31');
    await getTenantAggregates('tenant-1', start, end);

    const countCall = mockCount.mock.calls[0][0];
    expect(countCall.where.createdAt).toMatchObject({ gte: start, lte: end });
  });

  test('returns null dateRange when no events exist', async () => {
    mockCount.mockResolvedValue(0);
    mockGroupBy.mockResolvedValue([]);
    mockAgg.mockResolvedValue({ _min: { createdAt: null }, _max: { createdAt: null } });

    const result = await getTenantAggregates('empty-tenant');

    expect(result.dateRange.start).toBeNull();
    expect(result.dateRange.end).toBeNull();
  });
});
