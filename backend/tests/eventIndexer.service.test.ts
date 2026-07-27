import { MockRpcServer } from './helpers/mockRpcServer';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';

jest.mock('@stellar/stellar-sdk', () => {
  class MockScVal {
    constructor(private value: unknown) {}

    sym() {
      return { toString: () => this.value };
    }

    address() {
      return { toString: () => this.value };
    }

    i128() {
      return { toString: () => this.value };
    }

    u64() {
      return { toString: () => this.value };
    }

    toXDR() {
      return 'mock-xdr';
    }
  }

  return {
    rpc: {
      Server: class {
        constructor(public url: string) {}
        async getEvents() {
          const response = await fetch(this.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'getEvents' }),
          });
          const payload = await response.json();
          const events = (payload.result?.events ?? []).map((event: any) => ({
            ...event,
            topic: (event.topic ?? []).map((item: any) => {
              if (item.type === 'symbol') return new MockScVal(item.value);
              if (item.type === 'address') return new MockScVal(item.value);
              return new MockScVal('');
            }),
            value: new MockScVal(event.value?.value ?? '0'),
          }));
          return { events };
        }
      },
    },
    xdr: {
      ScVal: {
        scvSymbol: (value: string) => new MockScVal(value),
        scvAddress: (value: string) => new MockScVal(value),
        scvI128: (value: string) => new MockScVal(value),
      },
      ScAddress: {
        scAddressTypeAccount: (value: unknown) => value,
        scAddressTypeContract: (value: unknown) => value,
      },
      PublicKey: {
        publicKeyTypeEd25519: (value: unknown) => value,
      },
      Int128Parts: class {},
      Int64: {
        fromString: (value: string) => value,
      },
      Uint64: {
        fromString: (value: string) => value,
      },
    },
  };
});

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

import prisma from '../src/lib/prisma';
import { EventIndexer } from '../src/services/eventIndexer';

const db = prisma as unknown as InMemoryPrismaClient;

describe('EventIndexer', () => {
  let mockRpc: MockRpcServer;

  beforeAll(async () => {
    mockRpc = new MockRpcServer();
    await mockRpc.start();
  });

  afterAll(async () => {
    await mockRpc.stop();
  });

  beforeEach(() => {
    db.reset();
  });

  it('stores subscribe and executed events from Soroban RPC', async () => {
    mockRpc.setEvents([
      {
        type: 'subscribe',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 10,
      },
      {
        type: 'executed',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 11,
      },
    ]);

    const indexer = new EventIndexer(mockRpc.baseUrl, 'CTEST');
    await indexer.fetchAndStoreEvents();

    const storedEvents = await db.event.findMany();
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents.map((event) => event.type).sort()).toEqual(['executed', 'subscribe']);
    expect(storedEvents.map((event) => event.amount)).toEqual(['1000', '1000']);
  });

  it('ignores non-subscribe/executed events and skips duplicates', async () => {
    mockRpc.setEvents([
      {
        type: 'cancel',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '0',
        ledger: 12,
      },
      {
        type: 'subscribe',
        subscriber: 'GSUB1',
        merchant: 'GMERCHANT1',
        token: 'CTOKEN1',
        amount: '1000',
        ledger: 10,
      },
    ]);

    const indexer = new EventIndexer(mockRpc.baseUrl, 'CTEST');
    await indexer.fetchAndStoreEvents();
    await indexer.fetchAndStoreEvents();

    const storedEvents = await db.event.findMany();
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].type).toBe('subscribe');
  });
});
