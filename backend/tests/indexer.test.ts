/**
 * Unit tests for IndexerService (#1372)
 *
 * Mocks the Soroban RPC and pg Pool to isolate the indexer logic.
 */

import { IndexerService, DecodedEvent } from '../../src/services/indexer';
import { xdr } from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Helpers to build mock ScVal objects
// ---------------------------------------------------------------------------

function makeSymbolScVal(name: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(Buffer.from(name));
}

function makeAddressScVal(hex: string): xdr.ScVal {
  const contractId = Buffer.from(hex.padEnd(64, '0').slice(0, 64), 'hex');
  const scAddr = xdr.ScAddress.scAddressTypeContract(contractId);
  return xdr.ScVal.scvAddress(scAddr);
}

function makeI128ScVal(value: bigint): xdr.ScVal {
  const hi = xdr.Int64.fromString((value >> 64n).toString());
  const lo = xdr.Uint64.fromString((value & 0xFFFFFFFFFFFFFFFFn).toString());
  return xdr.ScVal.scvI128(new xdr.Int128Parts({ hi, lo }));
}

function mockRawEvent(
  name: string,
  subscriber: string,
  merchant: string,
  amount: bigint,
  id = '001',
  txHash = 'abc123',
  ledger: number | string = 1000,
): object {
  return {
    id,
    txHash,
    ledger,
    ledgerClosedAt: '2024-01-01T00:00:00Z',
    topic: [
      makeSymbolScVal(name),
      makeAddressScVal(subscriber),
      makeAddressScVal(merchant),
    ],
    value: makeI128ScVal(amount),
  };
}

// ---------------------------------------------------------------------------
// Mock pool factory
// ---------------------------------------------------------------------------

function createMockPool() {
  const querySpy = jest.fn().mockResolvedValue({ rows: [] });
  const releaseSpy = jest.fn();
  const connectSpy = jest.fn().mockResolvedValue({
    query: querySpy,
    release: releaseSpy,
  });

  return {
    query: querySpy,
    connect: connectSpy,
    end: jest.fn(),
    _releaseSpy: releaseSpy,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IndexerService', () => {
  let indexer: IndexerService;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockRpc: {
    getEvents: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool = createMockPool();

    // Seed cursor query response
    mockPool.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('indexer_state')) {
        return Promise.resolve({ rows: [{ cursor: '' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    indexer = new IndexerService({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'CAFAKE0000000000000000000000000000000000000000000000000000000000',
      pollIntervalMs: 99999999, // prevent auto-scheduling during tests
    });

    // Inject mock pool directly
    (indexer as unknown as { pool: typeof mockPool }).pool = mockPool as unknown as typeof mockPool;

    // Inject mock rpc
    mockRpc = { getEvents: jest.fn() };
    (indexer as unknown as { rpc: typeof mockRpc }).rpc = mockRpc;
  });

  // -------------------------------------------------------------------------
  // decodeEvent
  // -------------------------------------------------------------------------

  describe('decodeEvent', () => {
    it('decodes a subscribe event', () => {
      const raw = mockRawEvent('subscribe', 'aa'.repeat(32), 'bb'.repeat(32), 1000n);
      const decoded = indexer.decodeEvent(raw as never);

      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('subscribe');
      expect(decoded!.amount).toBe('1000');
      expect(decoded!.txHash).toBe('abc123');
    });

    it('decodes an executed event', () => {
      const raw = mockRawEvent('executed', 'cc'.repeat(32), 'dd'.repeat(32), 500n);
      const decoded = indexer.decodeEvent(raw as never);

      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('executed');
      expect(decoded!.amount).toBe('500');
    });

    it('decodes a cancel event', () => {
      const raw = mockRawEvent('cancel', 'ee'.repeat(32), 'ff'.repeat(32), 0n);
      const decoded = indexer.decodeEvent(raw as never);

      expect(decoded!.type).toBe('cancel');
    });

    it('decodes a payment_transfer_failure event', () => {
      const raw = mockRawEvent(
        'payment_transfer_failure',
        '11'.repeat(32),
        '22'.repeat(32),
        200n,
      );
      const decoded = indexer.decodeEvent(raw as never);

      expect(decoded!.type).toBe('payment_transfer_failure');
    });

    it('returns null for unknown event names', () => {
      const raw = mockRawEvent('unknown_event', 'aa'.repeat(32), 'bb'.repeat(32), 0n);
      const decoded = indexer.decodeEvent(raw as never);

      expect(decoded).toBeNull();
    });

    it('returns null if topics array is too short', () => {
      const raw = {
        id: '001',
        txHash: 'xyz',
        ledger: 1,
        ledgerClosedAt: '',
        topic: [makeSymbolScVal('subscribe')],
        value: makeI128ScVal(0n),
      };
      const decoded = indexer.decodeEvent(raw as never);
      expect(decoded).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Cursor management
  // -------------------------------------------------------------------------

  describe('loadCursor', () => {
    it('returns empty string when no cursor row exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const cursor = await indexer.loadCursor();
      expect(cursor).toBe('');
    });

    it('returns stored cursor value', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cursor: '12345-0001' }] });
      const cursor = await indexer.loadCursor();
      expect(cursor).toBe('12345-0001');
    });
  });

  describe('saveCursor', () => {
    it('calls upsert with correct cursor value', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      await indexer.saveCursor('99999-0050');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT (id)'),
        ['99999-0050'],
      );
    });
  });

  // -------------------------------------------------------------------------
  // persistEvent
  // -------------------------------------------------------------------------

  describe('persistEvent', () => {
    const baseEvent: DecodedEvent = {
      type: 'subscribe',
      subscriber: 'GSUB',
      merchant: 'GMER',
      amount: '1000',
      txHash: 'txhash1',
      ledgerSeq: 1001,
      occurredAt: new Date('2024-01-01'),
    };

    it('issues BEGIN/COMMIT for a subscribe event', async () => {
      const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
      const clientRelease = jest.fn();
      mockPool.connect.mockResolvedValue({
        query: clientQuery,
        release: clientRelease,
      });

      await indexer.persistEvent(baseEvent);

      expect(clientQuery).toHaveBeenCalledWith('BEGIN');
      expect(clientQuery).toHaveBeenCalledWith('COMMIT');
      expect(clientRelease).toHaveBeenCalled();
    });

    it('calls ROLLBACK on error and rethrows', async () => {
      const clientQuery = jest
        .fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // upsert
      const clientRelease = jest.fn();
      mockPool.connect.mockResolvedValue({
        query: clientQuery,
        release: clientRelease,
      });

      await expect(indexer.persistEvent(baseEvent)).rejects.toThrow('DB error');
      expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(clientRelease).toHaveBeenCalled();
    });

    it('persists an executed event by recording payment and updating subscription', async () => {
      const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
      const clientRelease = jest.fn();
      mockPool.connect.mockResolvedValue({
        query: clientQuery,
        release: clientRelease,
      });

      await indexer.persistEvent({ ...baseEvent, type: 'executed' });

      const calls: string[] = clientQuery.mock.calls.map(
        (c: [string]) => c[0] as string,
      );
      expect(calls.some((q) => q.includes('INSERT INTO payments'))).toBe(true);
      expect(calls.some((q) => q.includes('UPDATE subscriptions'))).toBe(true);
    });

    it('marks subscription cancelled for cancel event', async () => {
      const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
      const clientRelease = jest.fn();
      mockPool.connect.mockResolvedValue({
        query: clientQuery,
        release: clientRelease,
      });

      await indexer.persistEvent({ ...baseEvent, type: 'cancel' });

      const calls: string[] = clientQuery.mock.calls.map(
        (c: [string]) => c[0] as string,
      );
      expect(
        calls.some((q) => q.includes("status = 'cancelled'")),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // poll — RPC integration
  // -------------------------------------------------------------------------

  describe('poll', () => {
    it('processes events returned by RPC and saves cursor', async () => {
      const rawEvent = mockRawEvent(
        'subscribe',
        'aa'.repeat(32),
        'bb'.repeat(32),
        100n,
        '1000-0001',
      );

      mockRpc.getEvents.mockResolvedValue({ events: [rawEvent] });

      // cursor load → empty
      mockPool.query.mockResolvedValueOnce({ rows: [{ cursor: '' }] });
      // all subsequent queries succeed
      mockPool.query.mockResolvedValue({ rows: [] });

      const clientQuery = jest.fn().mockResolvedValue({ rows: [] });
      const clientRelease = jest.fn();
      mockPool.connect.mockResolvedValue({
        query: clientQuery,
        release: clientRelease,
      });

      indexer['running'] = true;
      await indexer.poll();
      // stop auto-scheduling
      indexer.stop();

      expect(mockRpc.getEvents).toHaveBeenCalledTimes(2); // first page + empty follow-up
    });

    it('recovers after restart by loading cursor from DB', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ cursor: '500-0010' }] });
      mockPool.query.mockResolvedValue({ rows: [] });
      mockRpc.getEvents.mockResolvedValue({ events: [] });

      indexer['running'] = true;
      await indexer.poll();
      indexer.stop();

      const getEventsCall = mockRpc.getEvents.mock.calls[0][0] as { cursor?: string };
      expect(getEventsCall.cursor).toBe('500-0010');
    });
  });
});
