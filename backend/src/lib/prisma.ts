/**
 * prisma.ts — Prisma client singleton and tenant-scoped helpers.
 *
 * Exports:
 *   default  — the bare PrismaClient singleton; suitable for admin/unscoped
 *              operations (migrations, background jobs, super-admin queries).
 *
 *   withTenant(tenantId) — returns a TenantPrismaClient that auto-injects
 *              { merchant: tenantId } into every where-clause for tenant-owned
 *              models, making it ergonomically hard to accidentally issue an
 *              unscoped query when a tenant context is available.
 *
 *   TenantPrismaClient  — the class (exported for typing purposes).
 *
 * Usage:
 *   // Unscoped (admin/background jobs):
 *   import prisma from '../lib/prisma';
 *   await prisma.event.findMany({ where: { type: 'subscribe' } });
 *
 *   // Tenant-scoped (merchant API handlers):
 *   import { withTenant } from '../lib/prisma';
 *   const db = withTenant(res.locals.merchantAddress);
 *   await db.events.findMany({ where: { subscriber: '...' } });
 *   // → Prisma executes: WHERE subscriber = '...' AND merchant = '<tenantId>'
 */

import { PrismaClient } from '../generated/prisma';

// ─── Singleton base client ────────────────────────────────────────────────────

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

export default prisma;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Prisma findMany / findFirst / count argument shape (simplified). */
interface WhereArgs {
  where?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Generic find result — passes through whatever Prisma returns. */
type FindResult<T> = Promise<T[]>;
type FindFirstResult<T> = Promise<T | null>;
type CountResult = Promise<number>;

// ─── Tenant-scoped model proxy ────────────────────────────────────────────────

/**
 * Returns a copy of `args` with `{ merchant: tenantId }` merged into the
 * `where` clause.  Caller-supplied where fields are preserved; the tenant
 * filter is always added, overwriting any `merchant` the caller may have
 * provided (which would indicate a programming error: the tenant filter is
 * the authoritative source of truth).
 */
function mergeTenantWhere(tenantId: string, args?: WhereArgs): WhereArgs {
  const { where = {}, ...rest } = args ?? {};
  return {
    ...rest,
    where: { ...where, merchant: tenantId },
  };
}

/**
 * Creates a proxy object for a Prisma model delegate that auto-injects a
 * tenant `merchant` filter.
 *
 * @param delegate  The Prisma model delegate (e.g. prisma.event)
 * @param tenantId  The tenant identifier to inject
 */
function makeScopedModel<TModel extends Record<string, unknown>, TItem>(
  delegate: TModel,
  tenantId: string,
) {
  return {
    findMany(args?: WhereArgs): FindResult<TItem> {
      return (delegate.findMany as (a: WhereArgs) => FindResult<TItem>)(
        mergeTenantWhere(tenantId, args),
      );
    },
    findFirst(args?: WhereArgs): FindFirstResult<TItem> {
      return (delegate.findFirst as (a: WhereArgs) => FindFirstResult<TItem>)(
        mergeTenantWhere(tenantId, args),
      );
    },
    count(args?: WhereArgs): CountResult {
      return (delegate.count as (a: WhereArgs) => CountResult)(
        mergeTenantWhere(tenantId, args),
      );
    },
  };
}

// ─── TenantPrismaClient ───────────────────────────────────────────────────────

/**
 * A tenant-scoped Prisma wrapper.
 *
 * Every query on a scoped model automatically includes `{ merchant: tenantId }`
 * in the where clause — preventing cross-tenant data leakage and making
 * unscoped queries the non-default, intentional choice.
 *
 * Obtain an instance via `withTenant(tenantId)` rather than constructing
 * directly.
 */
export class TenantPrismaClient {
  /** The tenant identifier injected into every query. */
  readonly tenantId: string;

  /** Tenant-scoped Event queries. */
  readonly events: ReturnType<typeof makeScopedModel<typeof prisma.event, unknown>>;

  /** Tenant-scoped Subscription queries. */
  readonly subscriptions: ReturnType<typeof makeScopedModel<typeof prisma.subscription, unknown>>;

  /** Tenant-scoped Payment queries. */
  readonly payments: ReturnType<typeof makeScopedModel<typeof prisma.payment, unknown>>;

  /** Tenant-scoped WebhookEndpoint queries. */
  readonly webhookEndpoints: ReturnType<typeof makeScopedModel<typeof prisma.webhookEndpoint, unknown>>;

  /** Tenant-scoped WebhookDelivery queries. */
  readonly webhookDeliveries: ReturnType<typeof makeScopedModel<typeof prisma.webhookDelivery, unknown>>;

  constructor(tenantId: string) {
    if (!tenantId || tenantId.trim() === '') {
      throw new Error('TenantPrismaClient: tenantId must be a non-empty string');
    }
    this.tenantId = tenantId;
    this.events = makeScopedModel(prisma.event, tenantId);
    this.subscriptions = makeScopedModel(prisma.subscription, tenantId);
    this.payments = makeScopedModel(prisma.payment, tenantId);
    this.webhookEndpoints = makeScopedModel(prisma.webhookEndpoint, tenantId);
    this.webhookDeliveries = makeScopedModel(prisma.webhookDelivery, tenantId);
  }

  /**
   * Delegates to the underlying `prisma.$transaction`.
   * The caller is responsible for using tenant-scoped operations inside the
   * transaction — the wrapper cannot enforce scoping within the callback.
   */
  $transaction<T>(
    fn: Parameters<typeof prisma.$transaction>[0],
    options?: Parameters<typeof prisma.$transaction>[1],
  ): ReturnType<typeof prisma.$transaction> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (prisma.$transaction as any)(fn, options);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a tenant-scoped Prisma client for the given tenant (merchant) ID.
 *
 * @param tenantId  Non-empty merchant Stellar address or internal tenant ID.
 * @throws Error if tenantId is empty or whitespace-only.
 *
 * @example
 * const db = withTenant(res.locals.merchantAddress);
 * const subs = await db.subscriptions.findMany({ where: { status: 'ACTIVE' } });
 * // executes: WHERE status = 'ACTIVE' AND merchant = '<merchantAddress>'
 */
export function withTenant(tenantId: string): TenantPrismaClient {
  return new TenantPrismaClient(tenantId);
}
