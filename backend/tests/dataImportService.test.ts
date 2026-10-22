/**
 * Tests for #734 — Data import service.
 */

import {
  parseCsv,
  parseJson,
  parseXml,
  detectFormat,
  validateRows,
  detectDuplicates,
  FieldSchema,
  DuplicateStrategy,
} from '../src/services/dataImportService';

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------
jest.mock('../src/lib/prisma', () => {
  const jobs: Record<number, unknown> = {};
  let nextId = 1;

  return {
    __esModule: true,
    default: {
      importJob: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = nextId++;
          jobs[id] = { id, processedRows: 0, errorCount: 0, ...data, createdAt: new Date(), updatedAt: new Date() };
          return jobs[id];
        }),
        update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          jobs[where.id] = { ...jobs[where.id] as object, ...data, updatedAt: new Date() };
          return jobs[where.id];
        }),
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) => jobs[where.id] ?? null),
        findMany: jest.fn(async () => Object.values(jobs)),
      },
    },
  };
});

describe('Data Import Service — #734', () => {
  // -------------------------------------------------------------------------
  // CSV Parser
  // -------------------------------------------------------------------------
  describe('parseCsv', () => {
    it('parses simple CSV correctly', () => {
      const csv = 'name,age,email\nAlice,30,alice@example.com\nBob,25,bob@example.com';
      const rows = parseCsv(csv);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ name: 'Alice', age: '30', email: 'alice@example.com' });
      expect(rows[1]).toEqual({ name: 'Bob', age: '25', email: 'bob@example.com' });
    });

    it('handles quoted fields with commas', () => {
      const csv = 'name,address\nAlice,"123 Main St, Suite 4"';
      const rows = parseCsv(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0].address).toBe('123 Main St, Suite 4');
    });

    it('handles escaped double quotes', () => {
      const csv = 'description\n"She said ""hello"""';
      const rows = parseCsv(csv);

      expect(rows[0].description).toBe('She said "hello"');
    });

    it('returns empty array for header-only CSV', () => {
      const rows = parseCsv('name,age');
      expect(rows).toHaveLength(0);
    });

    it('handles CRLF line endings', () => {
      const csv = 'name,age\r\nAlice,30\r\nBob,25';
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(2);
    });

    it('returns empty array for empty content', () => {
      const rows = parseCsv('');
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // JSON Parser
  // -------------------------------------------------------------------------
  describe('parseJson', () => {
    it('parses a JSON array', () => {
      const json = JSON.stringify([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]);
      const rows = parseJson(json);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1, name: 'Alice' });
    });

    it('unwraps { data: [] } wrapper', () => {
      const json = JSON.stringify({ data: [{ id: 1 }] });
      const rows = parseJson(json);
      expect(rows).toHaveLength(1);
    });

    it('unwraps { items: [] } wrapper', () => {
      const json = JSON.stringify({ items: [{ id: 1 }] });
      const rows = parseJson(json);
      expect(rows).toHaveLength(1);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseJson('not json')).toThrow(/Invalid JSON/);
    });

    it('throws when no array found', () => {
      expect(() => parseJson(JSON.stringify({ foo: 'bar' }))).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // XML Parser
  // -------------------------------------------------------------------------
  describe('parseXml', () => {
    it('parses simple XML', () => {
      const xml = `<records><item><id>1</id><name>Alice</name></item><item><id>2</id><name>Bob</name></item></records>`;
      const rows = parseXml(xml);

      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: '1', name: 'Alice' });
      expect(rows[1]).toEqual({ id: '2', name: 'Bob' });
    });

    it('returns empty array for empty XML', () => {
      const xml = '<records></records>';
      const rows = parseXml(xml);
      expect(rows).toHaveLength(0);
    });

    it('throws on invalid XML structure', () => {
      expect(() => parseXml('not xml')).toThrow(/Invalid XML/);
    });
  });

  // -------------------------------------------------------------------------
  // Format detection
  // -------------------------------------------------------------------------
  describe('detectFormat', () => {
    it('detects CSV by extension', () => {
      expect(detectFormat('data.csv', '')).toBe('csv');
    });

    it('detects JSON by extension', () => {
      expect(detectFormat('data.json', '')).toBe('json');
    });

    it('detects XML by extension', () => {
      expect(detectFormat('data.xml', '')).toBe('xml');
    });

    it('sniffs JSON by content', () => {
      expect(detectFormat('data.txt', '[{"id":1}]')).toBe('json');
    });

    it('sniffs XML by content', () => {
      expect(detectFormat('data.txt', '<records/>')).toBe('xml');
    });

    it('falls back to CSV', () => {
      expect(detectFormat('data.txt', 'name,age\nAlice,30')).toBe('csv');
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe('validateRows', () => {
    const schema: FieldSchema[] = [
      { name: 'name', required: true, type: 'string', maxLength: 50 },
      { name: 'email', required: true, type: 'email' },
      { name: 'age', required: false, type: 'number' },
      { name: 'phone', required: false, type: 'phone' },
    ];

    it('passes valid rows', () => {
      const rows = [{ name: 'Alice', email: 'alice@example.com', age: '30' }];
      const errors = validateRows(rows, schema);
      expect(errors).toHaveLength(0);
    });

    it('catches missing required fields', () => {
      const rows = [{ name: '', email: '' }];
      const errors = validateRows(rows, schema);
      expect(errors.some(e => e.field === 'name')).toBe(true);
      expect(errors.some(e => e.field === 'email')).toBe(true);
    });

    it('catches invalid email format', () => {
      const rows = [{ name: 'Alice', email: 'not-an-email' }];
      const errors = validateRows(rows, schema);
      expect(errors.some(e => e.field === 'email' && e.message.includes('valid email'))).toBe(true);
    });

    it('catches non-numeric age', () => {
      const rows = [{ name: 'Alice', email: 'a@b.com', age: 'NaN_value' }];
      const errors = validateRows(rows, schema);
      expect(errors.some(e => e.field === 'age')).toBe(true);
    });

    it('catches string exceeding maxLength', () => {
      const rows = [{ name: 'A'.repeat(51), email: 'a@b.com' }];
      const errors = validateRows(rows, schema);
      expect(errors.some(e => e.field === 'name' && e.message.includes('max length'))).toBe(true);
    });

    it('validates phone format', () => {
      const rows = [{ name: 'Alice', email: 'a@b.com', phone: 'not-a-phone' }];
      const errors = validateRows(rows, schema);
      expect(errors.some(e => e.field === 'phone')).toBe(true);
    });

    it('accepts valid E.164 phone', () => {
      const rows = [{ name: 'Alice', email: 'a@b.com', phone: '+14155551234' }];
      const errors = validateRows(rows, schema);
      expect(errors.filter(e => e.field === 'phone')).toHaveLength(0);
    });

    it('returns empty errors when no schema given', () => {
      const rows = [{ anything: 'goes', here: 'too' }];
      const errors = validateRows(rows, []);
      expect(errors).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate detection
  // -------------------------------------------------------------------------
  describe('detectDuplicates', () => {
    it('detects within-batch duplicates', () => {
      const rows = [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
        { id: '1', name: 'Alice Duplicate' }, // duplicate
      ];
      const dupes = detectDuplicates(rows, 'id', 'skip');

      expect(dupes).toHaveLength(1);
      expect(dupes[0].key).toBe('1');
      expect(dupes[0].row).toBe(3);
      expect(dupes[0].action).toBe('skip');
    });

    it('detects cross-batch duplicates using existingKeys', () => {
      const rows = [{ id: '5', name: 'Charlie' }];
      const existing = new Set(['5']);
      const dupes = detectDuplicates(rows, 'id', 'overwrite', existing);

      expect(dupes).toHaveLength(1);
      expect(dupes[0].action).toBe('overwrite');
    });

    it('returns empty when no duplicates', () => {
      const rows = [{ id: '1' }, { id: '2' }, { id: '3' }];
      const dupes = detectDuplicates(rows, 'id', 'skip');
      expect(dupes).toHaveLength(0);
    });

    it('skips rows with empty key field', () => {
      const rows = [{ id: '', name: 'Alice' }, { id: '', name: 'Bob' }];
      const dupes = detectDuplicates(rows, 'id', 'skip');
      expect(dupes).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Import job (async, using mocked prisma)
  // -------------------------------------------------------------------------
  describe('createImportJob', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createImportJob, getImportJob } = require('../src/services/dataImportService');

    it('creates a job and returns a numeric jobId', async () => {
      const csv = 'name,email\nAlice,alice@example.com';
      const jobId = await createImportJob('user-1', 'test.csv', csv);

      expect(typeof jobId).toBe('number');
      expect(jobId).toBeGreaterThan(0);
    });

    it('getImportJob returns null for unknown id', async () => {
      const job = await getImportJob(999999);
      expect(job).toBeNull();
    });
  });
});
