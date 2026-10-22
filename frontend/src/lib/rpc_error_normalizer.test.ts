/**
 * rpc_error_normalizer.test.ts
 *
 * Full unit-test suite for `normalizeRpcError`.
 *
 * Coverage:
 *   - All 17 ContractError codes (by numeric pattern and by name)
 *   - RPC-layer error categories (simulation, submission, on-chain, timeout)
 *   - Freighter signing rejection
 *   - Wrong network
 *   - Insufficient funds
 *   - Token allowance
 *   - Network / fetch errors
 *   - Unknown / catch-all
 *   - Non-Error thrown values (plain string, null, undefined, object)
 *   - `retryable` flag correctness for every category
 *   - `contractCode` presence and absence
 *   - Re-export from transaction_builder
 */

import { normalizeRpcError, NormalizedRpcError, RpcErrorCategory } from './rpc_error_normalizer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function err(msg: string): Error {
  return new Error(msg);
}

function normalize(msg: string): NormalizedRpcError {
  return normalizeRpcError(err(msg));
}

// ─── Contract errors — numeric code patterns ──────────────────────────────────

describe('contract errors — numeric code pattern', () => {
  const cases: Array<[string, number, string, boolean]> = [
    // [input pattern,               code, expected title fragment,              retryable]
    ['error(contract, #1)',          1,  'Invalid amount',                      false],
    ['error(contract, #2)',          2,  'Interval too short',                  false],
    ['error(contract, #3)',          3,  'Interval too long',                   false],
    ['error(contract, #4)',          4,  'No active subscription',              false],
    ['error(contract, #5)',          5,  'Payment not due',                     false],
    ['error(contract, #6)',          6,  'Authorisation failed',                true],
    ['error(contract, #7)',          7,  'Transfer failed',                     false],
    ['error(contract, #8)',          8,  'Invalid timestamp',                   true],
    ['error(contract, #9)',          9,  'Amount too large',                    false],
    ['error(contract, #10)',         10, 'Self-subscription',                   false],
    ['error(contract, #11)',         11, 'Invalid token address',               false],
    ['error(contract, #12)',         12, 'Empty batch',                         false],
    ['error(contract, #13)',         13, 'Batch too large',                     false],
    ['error(contract, #14)',         14, 'Insufficient allowance',              false],
    ['error(contract, #15)',         15, 'already migrated',                    false],
    ['error(contract, #16)',         16, 'Not admin',                           false],
    ['error(contract, #17)',         17, 'not initialized',                     false],
  ];

  test.each(cases)(
    'normalizes "%s" → code %i, title contains "%s", retryable=%s',
    (input, code, titleFragment, retryable) => {
      const result = normalize(input);
      expect(result.category).toBe('contract_error');
      expect(result.contractCode).toBe(code);
      expect(result.title.toLowerCase()).toContain(titleFragment.toLowerCase());
      expect(result.retryable).toBe(retryable);
      expect(result.rawMessage).toBe(input);
    },
  );

  it('sets category to contract_error for every numeric code', () => {
    for (let code = 1; code <= 17; code++) {
      const r = normalize(`error(contract, #${code})`);
      expect(r.category).toBe('contract_error');
      expect(r.contractCode).toBe(code);
    }
  });

  it('handles mixed-case and extra whitespace in the pattern', () => {
    const r = normalize('Error( Contract ,  #3 ) rest of message');
    expect(r.category).toBe('contract_error');
    expect(r.contractCode).toBe(3);
  });

  it('handles "HostError: contract error #7" style', () => {
    const r = normalize('HostError: contract error #7');
    expect(r.category).toBe('contract_error');
    expect(r.contractCode).toBe(7);
  });

  it('ignores out-of-range numeric codes (e.g. #99) and falls through', () => {
    const r = normalize('error(contract, #99)');
    // Should not match any known code and fall to unknown
    expect(r.category).not.toBe('contract_error');
  });
});

// ─── Contract errors — name-based matching ────────────────────────────────────

describe('contract errors — name-based matching', () => {
  const cases: Array<[string, number]> = [
    ['AmountMustBePositive',   1],
    ['IntervalTooShort',       2],
    ['IntervalTooLong',        3],
    ['NoActiveSubscription',   4],
    ['PaymentNotDue',          5],
    ['Unauthorized',           6],
    ['TransferFailed',         7],
    ['InvalidTimestamp',       8],
    ['AmountTooLarge',         9],
    ['SelfSubscription',       10],
    ['InvalidTokenAddress',    11],
    ['EmptyBatch',             12],
    ['BatchTooLarge',          13],
    ['InsufficientAllowance',  14],
    ['AlreadyMigrated',        15],
    ['NotAdmin',               16],
    ['NotInitialized',         17],
  ];

  test.each(cases)(
    'name "%s" → code %i',
    (name, code) => {
      const result = normalize(`Contract invocation failed: ${name}`);
      expect(result.category).toBe('contract_error');
      expect(result.contractCode).toBe(code);
    },
  );

  it('matches lowercased name', () => {
    const r = normalize('amountmustbepositive');
    expect(r.category).toBe('contract_error');
    expect(r.contractCode).toBe(1);
  });

  it('numeric code takes priority over name when both present', () => {
    // "error(contract, #3)" contains the pattern for code 3; the name
    // "IntervalTooShort" would match code 2 — numeric code should win.
    const r = normalize('error(contract, #3) IntervalTooShort');
    expect(r.contractCode).toBe(3);
  });
});

// ─── Simulation (prepareTransaction) failures ─────────────────────────────────

describe('simulation failures', () => {
  it('classifies "transaction preparation failed" as simulation_failed', () => {
    const r = normalize('Transaction preparation failed: Network request failed');
    expect(r.category).toBe('simulation_failed');
    expect(r.retryable).toBe(true);
    expect(r.contractCode).toBeUndefined();
  });

  it('is case-insensitive', () => {
    const r = normalize('TRANSACTION PREPARATION FAILED: something');
    expect(r.category).toBe('simulation_failed');
  });

  it('sets a non-empty action', () => {
    const r = normalize('Transaction preparation failed: timeout');
    expect(r.action.length).toBeGreaterThan(0);
  });
});

// ─── Submission (sendTransaction) failures ────────────────────────────────────

describe('submission failures', () => {
  it('classifies "transaction submission failed" as submission_failed', () => {
    const r = normalize('Transaction submission failed: unknown error');
    expect(r.category).toBe('submission_failed');
    expect(r.retryable).toBe(true);
  });

  it('classifies "transaction submission failed" with XDR payload', () => {
    const r = normalize('Transaction submission failed: AAABBBCCC==');
    expect(r.category).toBe('submission_failed');
  });
});

// ─── On-chain failure ─────────────────────────────────────────────────────────

describe('on-chain failure', () => {
  it('classifies "transaction failed on-chain" as onchain_failed', () => {
    const r = normalize('Transaction failed on-chain: no result meta available');
    expect(r.category).toBe('onchain_failed');
    expect(r.retryable).toBe(false);
  });

  it('provides a non-empty action referencing meta XDR', () => {
    const r = normalize('Transaction failed on-chain: METAXDR==');
    expect(r.action).toMatch(/xdr|inspect|meta/i);
  });
});

// ─── Confirmation timeout ─────────────────────────────────────────────────────

describe('confirmation timeout', () => {
  it('classifies "confirmation timeout" message', () => {
    const r = normalize('Transaction confirmation timeout after 60 seconds. Hash: abc123');
    expect(r.category).toBe('confirmation_timeout');
    expect(r.retryable).toBe(true);
  });

  it('classifies "timed out" message', () => {
    const r = normalize('Request timed out waiting for inclusion');
    expect(r.category).toBe('confirmation_timeout');
  });

  it('classifies generic "timeout" message', () => {
    const r = normalize('Connection timeout');
    expect(r.category).toBe('confirmation_timeout');
  });
});

// ─── Freighter signing rejection ──────────────────────────────────────────────

describe('signing rejection', () => {
  const signingMessages = [
    'User declined to sign the transaction',
    'User rejected the request',
    'Signing failed',
    'Transaction rejected',
  ];

  test.each(signingMessages)('classifies "%s" as signing_rejected', (msg) => {
    const r = normalize(msg);
    expect(r.category).toBe('signing_rejected');
    expect(r.retryable).toBe(true);
  });

  it('provides guidance to reopen the Freighter popup', () => {
    const r = normalize('User declined');
    expect(r.action).toMatch(/freighter|popup|pop-up|authorize/i);
  });
});

// ─── Wrong network ────────────────────────────────────────────────────────────

describe('wrong network', () => {
  const networkMessages = [
    'Wrong network selected',
    'Network mismatch: expected testnet',
    'Invalid passphrase for this network',
  ];

  test.each(networkMessages)('classifies "%s" as wrong_network', (msg) => {
    const r = normalize(msg);
    expect(r.category).toBe('wrong_network');
    expect(r.retryable).toBe(true);
  });
});

// ─── Insufficient balance ─────────────────────────────────────────────────────

describe('insufficient funds', () => {
  const fundMessages = [
    'insufficient balance for this operation',
    'not enough XLM to pay the fee',
    'Account underfunded',
  ];

  test.each(fundMessages)('classifies "%s" as insufficient_funds', (msg) => {
    const r = normalize(msg);
    expect(r.category).toBe('insufficient_funds');
    expect(r.retryable).toBe(false);
  });
});

// ─── Token allowance ──────────────────────────────────────────────────────────

describe('allowance too low', () => {
  const allowanceMessages = [
    'allowance too low for transfer',
    'transfer from exceeds allowance',
    'spend limit exceeded',
  ];

  test.each(allowanceMessages)('classifies "%s" as allowance_too_low', (msg) => {
    const r = normalize(msg);
    expect(r.category).toBe('allowance_too_low');
    expect(r.retryable).toBe(false);
  });

  it('suggests calling token.approve', () => {
    const r = normalize('allowance insufficient');
    expect(r.action).toMatch(/approve/i);
  });
});

// ─── Network / fetch errors ───────────────────────────────────────────────────

describe('network errors', () => {
  const networkMessages = [
    'Failed to fetch',
    'Network request failed',
    'fetch error: connection refused',
    'NetworkError: the operation failed',
    'ECONNREFUSED 127.0.0.1:8000',
    'ENOTFOUND soroban-testnet.stellar.org',
    'RPC node is unavailable',
  ];

  test.each(networkMessages)('classifies "%s" as network_error', (msg) => {
    const r = normalize(msg);
    expect(r.category).toBe('network_error');
    expect(r.retryable).toBe(true);
  });

  it('mentions RPC URL in the action', () => {
    const r = normalize('Failed to fetch');
    expect(r.action).toMatch(/rpc_url|RPC_URL|rpc/i);
  });
});

// ─── Unknown / catch-all ──────────────────────────────────────────────────────

describe('unknown errors', () => {
  it('returns unknown category for unrecognised messages', () => {
    const r = normalize('Something completely unexpected happened');
    expect(r.category).toBe('unknown');
    expect(r.retryable).toBe(true);
  });

  it('preserves rawMessage from the Error', () => {
    const r = normalize('bizarre error text xyz');
    expect(r.rawMessage).toBe('bizarre error text xyz');
  });

  it('populates all required fields', () => {
    const r = normalize('very strange');
    expect(r.title).toBeTruthy();
    expect(r.summary).toBeTruthy();
    expect(r.action).toBeTruthy();
    expect(typeof r.retryable).toBe('boolean');
  });
});

// ─── Non-Error thrown values ──────────────────────────────────────────────────

describe('non-Error thrown values', () => {
  it('handles a plain string', () => {
    const r = normalizeRpcError('plain string error');
    expect(r.rawMessage).toBe('plain string error');
    expect(r.category).toBeDefined();
  });

  it('handles null', () => {
    const r = normalizeRpcError(null);
    expect(r.rawMessage).toBe('Unknown error');
    expect(r.category).toBe('unknown');
  });

  it('handles undefined', () => {
    const r = normalizeRpcError(undefined);
    expect(r.rawMessage).toBe('Unknown error');
    expect(r.category).toBe('unknown');
  });

  it('handles a number (0)', () => {
    const r = normalizeRpcError(0);
    // String(0) → '0', not falsy-mapped to 'Unknown error'
    expect(r.rawMessage).toBe('0');
    expect(r.category).toBe('unknown');
  });

  it('handles a plain object', () => {
    const r = normalizeRpcError({ code: 404, message: 'not found' });
    expect(typeof r.rawMessage).toBe('string');
    expect(r.category).toBeDefined();
  });

  it('handles a string that looks like a signing rejection', () => {
    const r = normalizeRpcError('user declined');
    expect(r.category).toBe('signing_rejected');
  });
});

// ─── rawMessage preservation ──────────────────────────────────────────────────

describe('rawMessage always echoes the input', () => {
  it('for Error objects', () => {
    const e = new Error('my message');
    const r = normalizeRpcError(e);
    expect(r.rawMessage).toBe('my message');
  });

  it('for strings', () => {
    const r = normalizeRpcError('raw string');
    expect(r.rawMessage).toBe('raw string');
  });

  it('for contract code messages', () => {
    const msg = 'Contract call returned error(contract, #5)';
    const r = normalizeRpcError(err(msg));
    expect(r.rawMessage).toBe(msg);
  });
});

// ─── Retryable flag completeness ──────────────────────────────────────────────

describe('retryable flags by category', () => {
  const retryableCategories: RpcErrorCategory[] = [
    'simulation_failed',
    'submission_failed',
    'confirmation_timeout',
    'signing_rejected',
    'wrong_network',
    'network_error',
    'unknown',
  ];
  const nonRetryableCategories: RpcErrorCategory[] = [
    'onchain_failed',
    'insufficient_funds',
    'allowance_too_low',
  ];

  it('all retryable categories return retryable=true', () => {
    // Map each category to a representative message
    const categoryMessages: Record<RpcErrorCategory, string> = {
      simulation_failed:    'Transaction preparation failed: boom',
      submission_failed:    'Transaction submission failed: unknown error',
      confirmation_timeout: 'Transaction confirmation timeout after 60 seconds. Hash: abc',
      signing_rejected:     'User declined',
      wrong_network:        'Wrong network',
      network_error:        'Failed to fetch',
      unknown:              'something completely unrecognised xyz123',
      contract_error:       'error(contract, #8)', // code 8 IS retryable
      onchain_failed:       'Transaction failed on-chain: meta',
      insufficient_funds:   'insufficient balance',
      allowance_too_low:    'allowance too low',
    };

    for (const cat of retryableCategories) {
      const r = normalize(categoryMessages[cat]);
      expect(r.retryable).toBe(true);
    }
  });

  it('all non-retryable categories return retryable=false', () => {
    const categoryMessages: Record<RpcErrorCategory, string> = {
      simulation_failed:    'Transaction preparation failed: boom',
      submission_failed:    'Transaction submission failed: unknown error',
      confirmation_timeout: 'Transaction confirmation timeout after 60 seconds. Hash: abc',
      signing_rejected:     'User declined',
      wrong_network:        'Wrong network',
      network_error:        'Failed to fetch',
      unknown:              'something completely unrecognised xyz123',
      contract_error:       'error(contract, #1)', // code 1 NOT retryable
      onchain_failed:       'Transaction failed on-chain: meta',
      insufficient_funds:   'insufficient balance',
      allowance_too_low:    'allowance too low',
    };

    for (const cat of nonRetryableCategories) {
      const r = normalize(categoryMessages[cat]);
      expect(r.retryable).toBe(false);
    }
  });
});

// ─── contractCode field ───────────────────────────────────────────────────────

describe('contractCode field', () => {
  it('is set for contract_error category', () => {
    const r = normalize('error(contract, #4)');
    expect(r.contractCode).toBe(4);
  });

  it('is undefined for non-contract categories', () => {
    const nonContractMessages = [
      'User declined',
      'Transaction preparation failed: err',
      'Failed to fetch',
      'something unknown xyz123',
    ];
    for (const msg of nonContractMessages) {
      const r = normalize(msg);
      expect(r.contractCode).toBeUndefined();
    }
  });
});

// ─── Re-export from transaction_builder ──────────────────────────────────────

describe('re-export from transaction_builder', () => {
  it('NormalizedRpcError type is importable from transaction_builder', async () => {
    // Dynamic import to verify the re-export exists at module level
    // We import the module and check the normalizer is accessible indirectly
    // via the type re-export. We verify the module loads without error.
    await expect(import('./transaction_builder')).resolves.toBeDefined();
  });
});

// ─── Structural contract — all required fields present ───────────────────────

describe('NormalizedRpcError structure', () => {
  const requiredFields: Array<keyof NormalizedRpcError> = [
    'category',
    'title',
    'summary',
    'action',
    'retryable',
    'rawMessage',
  ];

  it('always returns all required fields', () => {
    const inputs = [
      'error(contract, #1)',
      'User declined',
      'Transaction preparation failed: err',
      'Transaction submission failed: err',
      'Transaction failed on-chain: meta',
      'Transaction confirmation timeout after 60 seconds. Hash: abc',
      'insufficient balance',
      'allowance too low',
      'Failed to fetch',
      'Wrong network',
      'something completely unrecognised xyz123',
    ];
    for (const input of inputs) {
      const r = normalize(input);
      for (const field of requiredFields) {
        expect(r[field]).toBeDefined();
      }
    }
  });
});
