/**
 * stellarMock.ts
 *
 * Lightweight mock for @stellar/stellar-sdk used by auth.test.ts.
 * Avoids Jest's ESM incompatibility with @noble/hashes / uint8array-extras.
 *
 * "Transactions" are serialised as base64(JSON) — just enough structure for
 * authService.ts to parse.  Signing uses Node's native Ed25519.
 */

import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  createHash,
} from 'crypto';

// ─── Internal key representation ─────────────────────────────────────────────

interface KeyPairData {
  /** base64url-encoded 32-byte public key (the "x" JWK field) */
  x: string;
  /** base64url-encoded 32-byte private key (the "d" JWK field), or null */
  d: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function b64urlToB64(s: string): string {
  return s.replace(/-/g, '+').replace(/_/g, '/');
}

/** Derive a stable fake Stellar G-address from a 32-byte public key (base64url). */
function xToGAddress(x: string): string {
  const bytes = Buffer.from(b64urlToB64(x), 'base64');
  // Encode as uppercase base32 (A-Z2-7) to match Stellar G-address format.
  // We use a simple custom base32 table — no padding needed.
  const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let bitsLen = 0;
  let out = '';
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    bitsLen += 8;
    while (bitsLen >= 5) {
      bitsLen -= 5;
      out += TABLE[(bits >> bitsLen) & 0x1f];
    }
  }
  if (bitsLen > 0) out += TABLE[(bits << (5 - bitsLen)) & 0x1f];
  // Pad or truncate to exactly 55 chars so total address length is 56
  return 'G' + out.slice(0, 55).padEnd(55, 'A');
}

/** Reverse xToGAddress: extract the 32-byte public key as base64url. */
function gAddressToX(gAddress: string): string {
  const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const b32 = gAddress.slice(1); // strip 'G'
  let bits = 0;
  let bitsLen = 0;
  const bytes: number[] = [];
  for (const ch of b32) {
    const v = TABLE.indexOf(ch);
    if (v < 0) continue;
    bits = (bits << 5) | v;
    bitsLen += 5;
    if (bitsLen >= 8) {
      bitsLen -= 8;
      bytes.push((bits >> bitsLen) & 0xff);
    }
  }
  // Pad / truncate to 32 bytes for Ed25519 public key
  while (bytes.length < 32) bytes.push(0);
  return Buffer.from(bytes.slice(0, 32)).toString('base64url');
}

function makePrivKeyObj(data: KeyPairData): KeyObject {
  if (!data.d) throw new Error('No private key');
  return createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', d: data.d, x: data.x } as any,
    format: 'jwk',
  });
}

function makePubKeyObj(data: KeyPairData): KeyObject {
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: data.x } as any,
    format: 'jwk',
  });
}

// ─── MockKeypair ─────────────────────────────────────────────────────────────

export class MockKeypair {
  private _data: KeyPairData;

  constructor(data: KeyPairData) {
    this._data = data;
  }

  publicKey(): string {
    return xToGAddress(this._data.x);
  }

  secret(): string {
    return 'S_MOCK_' + this._data.d?.slice(0, 10);
  }

  sign(data: Buffer): Buffer {
    return nodeSign(null, data, makePrivKeyObj(this._data));
  }

  verify(data: Buffer, sig: Buffer): boolean {
    try {
      return nodeVerify(null, data, makePubKeyObj(this._data), sig);
    } catch {
      return false;
    }
  }

  static random(): MockKeypair {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privJwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string };
    return new MockKeypair({ x: privJwk.x, d: privJwk.d });
  }

  /** Reconstruct from a G-address (no private key). */
  static fromPublicKey(gAddress: string): MockKeypair {
    // Validate: must start with G and be 56 characters (Stellar public key format)
    if (typeof gAddress !== 'string' || !/^G[A-Z2-7]{55}$/.test(gAddress)) {
      throw new Error(`Invalid Stellar public key: ${gAddress}`);
    }
    return new MockKeypair({ x: gAddressToX(gAddress), d: null });
  }
}

// ─── MockOperation ────────────────────────────────────────────────────────────

interface ManageDataArgs {
  name: string;
  value: Buffer | null;
}

export const MockOperation = {
  manageData(args: ManageDataArgs): SerializedOp {
    return { type: 'manageData', name: args.name, valueHex: args.value?.toString('hex') ?? null };
  },
};

// ─── Serialised transaction format ───────────────────────────────────────────

interface SerializedOp {
  type: string;
  name?: string;
  valueHex?: string | null;
}

interface ParsedSignature {
  signerX: string;
  sigHex: string;
}

interface TxEnvelope {
  source: string;
  networkPassphrase: string;
  operations: SerializedOp[];
  signatures: ParsedSignature[];
}

// ─── MockTransaction ──────────────────────────────────────────────────────────

export class MockTransaction {
  source: string;
  operations: Array<{ type: string; name?: string; value?: Buffer }>;
  signatures: Array<{ signature: () => Buffer }>;

  private _networkPassphrase: string;
  private _rawSigs: ParsedSignature[];

  constructor(xdr: string, networkPassphrase: string) {
    let env: TxEnvelope;
    try {
      env = JSON.parse(Buffer.from(xdr, 'base64').toString('utf8')) as TxEnvelope;
    } catch {
      throw new Error('Invalid mock transaction XDR (not base64 JSON)');
    }

    if (!env.source || !env.operations) {
      throw new Error('Invalid mock transaction structure');
    }

    this.source = env.source;
    this._networkPassphrase = networkPassphrase;
    this._rawSigs = env.signatures ?? [];

    this.operations = env.operations.map((op) => ({
      type: op.type,
      name: op.name,
      value: op.valueHex != null ? Buffer.from(op.valueHex, 'hex') : undefined,
    }));

    this.signatures = this._rawSigs.map((s) => ({
      signature: () => Buffer.from(s.sigHex, 'hex'),
    }));
  }

  hash(): Buffer {
    // Deterministic hash: sha256 of (networkPassphrase + source + ops JSON)
    return createHash('sha256')
      .update(this._networkPassphrase)
      .update(this.source)
      .update(JSON.stringify(this.operations.map((o) => ({ type: o.type, name: o.name, valueHex: o.value?.toString('hex') }))))
      .digest();
  }

  sign(keypair: MockKeypair): void {
    const hash = this.hash();
    const sig = keypair.sign(hash);
    const x = gAddressToX(keypair.publicKey());
    this._rawSigs.push({ signerX: x, sigHex: sig.toString('hex') });
    this.signatures.push({ signature: () => sig });
  }

  toEnvelope(): { toXDR(enc: string): string } {
    const env: TxEnvelope = {
      source: this.source,
      networkPassphrase: this._networkPassphrase,
      operations: this.operations.map((op) => ({
        type: op.type,
        name: op.name,
        valueHex: op.value?.toString('hex') ?? null,
      })),
      signatures: this._rawSigs,
    };
    const json = JSON.stringify(env);
    return {
      toXDR(enc: string): string {
        return Buffer.from(json, 'utf8').toString('base64');
      },
    };
  }
}

// ─── MockAccount ─────────────────────────────────────────────────────────────

export class MockAccount {
  constructor(public id: string, public sequence: string) {}
}

// ─── MockTransactionBuilder ───────────────────────────────────────────────────

export class MockTransactionBuilder {
  private _source: MockAccount;
  private _ops: SerializedOp[] = [];
  private _networkPassphrase: string;
  private _timeout = 300;

  constructor(source: MockAccount, opts: { fee: string; networkPassphrase: string }) {
    this._source = source;
    this._networkPassphrase = opts.networkPassphrase;
  }

  addOperation(op: SerializedOp): this {
    this._ops.push(op);
    return this;
  }

  setTimeout(seconds: number): this {
    this._timeout = seconds;
    return this;
  }

  build(): MockTransaction {
    const env: TxEnvelope = {
      source: this._source.id,
      networkPassphrase: this._networkPassphrase,
      operations: this._ops,
      signatures: [],
    };
    const xdr = Buffer.from(JSON.stringify(env), 'utf8').toString('base64');
    return new MockTransaction(xdr, this._networkPassphrase);
  }
}

// ─── Re-exports matching @stellar/stellar-sdk named exports ──────────────────

export { gAddressToX };

export const BASE_FEE = '100';
export const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC: 'Public Global Stellar Network ; September 2015',
};
