/**
 * mockRpcServer.ts
 *
 * In-process mock of the Soroban RPC `getEvents` endpoint.
 * Avoids real network calls in integration tests.
 */

import * as http from 'http';

export interface MockRpcEvent {
  type: string;      // "subscribe" | "executed"
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;    // numeric string
  ledger: number;
}

export class MockRpcServer {
  private server: http.Server;
  private events: MockRpcEvent[] = [];
  public baseUrl = '';

  constructor() {
    this.server = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }

      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.buildResponse(body)));
      });
    });
  }

  /** Start the server on a random port. */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /** Replace the event set returned by subsequent RPC calls. */
  setEvents(events: MockRpcEvent[]): void {
    this.events = events;
  }

  private buildResponse(body: string): object {
    let method = '';
    try {
      method = JSON.parse(body).method;
    } catch {
      /* ignore */
    }

    if (method === 'getEvents') {
      return {
        jsonrpc: '2.0',
        id: 1,
        result: {
          events: this.events.map((e) => this.encodeEvent(e)),
          latestLedger: 999,
        },
      };
    }

    // Fallback for any other RPC methods (e.g. getLatestLedger)
    return { jsonrpc: '2.0', id: 1, result: { sequence: 999 } };
  }

  private encodeEvent(e: MockRpcEvent): object {
    // Return JSON-safe placeholders that the test's Stellar SDK mock can
    // reconstruct into ScVal-like objects for EventIndexer.
    return {
      topic: [
        { type: 'symbol', value: e.type },
        { type: 'address', value: 'GTESTSUBSCRIBER' },
        { type: 'address', value: 'GTESTMERCHANT' },
        { type: 'address', value: 'CTESTTOKEN' },
      ],
      value: { type: 'i128', value: e.amount },
      ledger: e.ledger,
      contractId: 'CTEST',
      id: `${e.ledger}-0`,
      pagingToken: `${e.ledger}-0`,
      inSuccessfulContractCall: true,
      ledgerClosedAt: new Date().toISOString(),
      txHash: 'deadbeef',
      type: 'contract',
    };
  }
}
