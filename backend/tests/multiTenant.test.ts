import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { tenantRegistry, tenantAdminRouter } from '../src/routes/adminTenants';
import { tenantAuthMiddleware } from '../src/middleware/tenantAuth';

const app = express();
app.use(express.json());
app.use(tenantAuthMiddleware);
app.use('/v1/admin', tenantAdminRouter);

describe('Multi-Tenant Architecture (#400 / BE-65)', () => {
  beforeEach(() => {
    tenantRegistry.clear();
    process.env.ADMIN_SECRET = 'test-admin-secret';
    process.env.JWT_SECRET = 'test-jwt-secret';
  });

  const tenantA = 'CCONTRACTA1234567890123456789012345678901234567890123456789';
  const tenantB = 'CCONTRACTB987654321098765432109876543210987654321098765432';

  it('should reject tenant provisioning without valid admin secret', async () => {
    const res = await request(app)
      .post('/v1/admin/tenants')
      .send({ name: 'Platform A', contract_id: tenantA });

    expect(res.status).toBe(401);
  });

  it('should provision a new tenant with valid X-Admin-Secret', async () => {
    const res = await request(app)
      .post('/v1/admin/tenants')
      .set('X-Admin-Secret', 'test-admin-secret')
      .send({ name: 'Platform A', contract_id: tenantA });

    expect(res.status).toBe(201);
    expect(res.body.tenant.name).toBe('Platform A');
    expect(res.body.tenant.contract_id).toBe(tenantA);
  });

  it('should reject duplicate tenant creation', async () => {
    await request(app)
      .post('/v1/admin/tenants')
      .set('X-Admin-Secret', 'test-admin-secret')
      .send({ name: 'Platform A', contract_id: tenantA });

    const res = await request(app)
      .post('/v1/admin/tenants')
      .set('X-Admin-Secret', 'test-admin-secret')
      .send({ name: 'Platform A Dup', contract_id: tenantA });

    expect(res.status).toBe(409);
  });

  it('should extract tenant_id from JWT claim in middleware', () => {
    const token = jwt.sign({ tenant_id: tenantA }, 'test-jwt-secret');
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {};
    const next = jest.fn();

    tenantAuthMiddleware(req, res, next);

    expect(req.tenantId).toBe(tenantA);
    expect(next).toHaveBeenCalled();
  });

  it('should extract tenant_id from X-Tenant-ID header in middleware', () => {
    const req: any = { headers: { 'x-tenant-id': tenantB } };
    const res: any = {};
    const next = jest.fn();

    tenantAuthMiddleware(req, res, next);

    expect(req.tenantId).toBe(tenantB);
    expect(next).toHaveBeenCalled();
  });
});
