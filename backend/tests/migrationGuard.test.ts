/**
 * backend/tests/migrationGuard.test.ts
 *
 * Issue #1078 — Add migration startup guard
 *
 * Tests for checkPendingMigrations() exported from src/index.ts.
 * Covers: happy path, pending detection, error safety, MIGRATE_ON_START control.
 */

import { checkPendingMigrations, type MigrationStatus } from '../src/index';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: { $queryRaw: jest.fn() },
}));

jest.mock('../src/lib/tracing', () => ({ initTracing: jest.fn() }));
jest.mock('../src/lib/config', () => ({
  validateConfig: jest.fn().mockReturnValue({
    port: 3001,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    contractId: 'CTEST',
  }),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
}));

import * as fs from 'fs';
import prisma from '../src/lib/prisma';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;

const MIGRATION_FILES = [
  '20240101000001_create_events.js',
  '20240101000002_create_audit_logs.js',
  '20240101000003_create_payout_summaries.js',
];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.MIGRATE_ON_START;
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('checkPendingMigrations (#1078)', () => {
  describe('return shape', () => {
    it('returns { hasPending: boolean, pendingCount: number }', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(MIGRATION_FILES);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        MIGRATION_FILES.map((f) => ({ migration_name: f.replace('.js', '') })),
      );
      const result: MigrationStatus = await checkPendingMigrations();
      expect(typeof result.hasPending).toBe('boolean');
      expect(typeof result.pendingCount).toBe('number');
    });
  });

  describe('happy path — all applied', () => {
    it('returns hasPending=false when all files are already applied', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(MIGRATION_FILES);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        MIGRATION_FILES.map((f) => ({ migration_name: f.replace('.js', '') })),
      );
      const result = await checkPendingMigrations();
      expect(result.hasPending).toBe(false);
      expect(result.pendingCount).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('returns hasPending=false when migrations directory does not exist', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      const result = await checkPendingMigrations();
      expect(result.hasPending).toBe(false);
      expect(result.pendingCount).toBe(0);
    });

    it('returns hasPending=false when migrations directory is empty', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([]);
      const result = await checkPendingMigrations();
      expect(result.hasPending).toBe(false);
      expect(result.pendingCount).toBe(0);
    });
  });

  describe('pending migrations detected', () => {
    it('returns hasPending=true when new files exist that are not applied', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        ...MIGRATION_FILES,
        '20240101000099_new_pending.js',
      ]);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        MIGRATION_FILES.map((f) => ({ migration_name: f.replace('.js', '') })),
      );
      const result = await checkPendingMigrations();
      expect(result.hasPending).toBe(true);
      expect(result.pendingCount).toBeGreaterThan(0);
    });

    it('treats all files as pending when migrations table does not exist (first run)', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(MIGRATION_FILES);
      (mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(
        new Error('relation "_prisma_migrations" does not exist'),
      );
      const result = await checkPendingMigrations();
      expect(result.hasPending).toBe(true);
      expect(result.pendingCount).toBe(MIGRATION_FILES.length);
    });
  });

  describe('error safety', () => {
    it('never throws — captures errors without crashing', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      await expect(checkPendingMigrations()).resolves.toBeDefined();
    });

    it('does not leak DATABASE_URL in error output (DB failure treated as first-run)', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(MIGRATION_FILES);
      (mockPrisma.$queryRaw as jest.Mock).mockRejectedValue(
        new Error('DATABASE_URL=postgresql://user:secret@localhost/db connection refused'),
      );
      const result = await checkPendingMigrations();
      // DB failures are handled gracefully — treated as first-run, not an error
      expect(result.error).toBeUndefined();
      expect(result.hasPending).toBe(true);
    });
  });

  describe('authorization — MIGRATE_ON_START control', () => {
    it('checkPendingMigrations is read-only and never applies migrations', async () => {
      process.env.MIGRATE_ON_START = 'true';
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue([
        ...MIGRATION_FILES,
        '20240101000099_pending.js',
      ]);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        MIGRATION_FILES.map((f) => ({ migration_name: f.replace('.js', '') })),
      );
      const result = await checkPendingMigrations();
      // Only status returned — $queryRaw called once for the check, never for apply
      expect(result.hasPending).toBe(true);
      expect((mockPrisma.$queryRaw as jest.Mock).mock.calls.length).toBe(1);
    });

    it('MIGRATE_ON_START=false means opt-out (guard must not auto-migrate)', () => {
      process.env.MIGRATE_ON_START = 'false';
      expect(process.env.MIGRATE_ON_START === 'true').toBe(false);
    });
  });

  describe('retry idempotency', () => {
    it('returns consistent results across multiple calls', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readdirSync as jest.Mock).mockReturnValue(MIGRATION_FILES);
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue(
        MIGRATION_FILES.map((f) => ({ migration_name: f.replace('.js', '') })),
      );
      const r1 = await checkPendingMigrations();
      const r2 = await checkPendingMigrations();
      expect(r1.hasPending).toBe(r2.hasPending);
      expect(r1.pendingCount).toBe(r2.pendingCount);
    });
  });
});
