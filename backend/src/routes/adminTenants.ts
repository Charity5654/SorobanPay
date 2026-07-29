import { Router, Request, Response } from 'express';

export const tenantAdminRouter = Router();
export const tenantRegistry = new Map<string, { id: string; name: string; contract_id: string }>();

tenantAdminRouter.post('/tenants', (req: Request, res: Response) => {
  const adminSecret = req.headers['x-admin-secret'];
  const expectedSecret = process.env.ADMIN_SECRET || 'admin-secret';

  if (adminSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized: Admin secret required' });
  }

  const { name, contract_id } = req.body;
  if (!name || !contract_id) {
    return res.status(400).json({ error: 'Missing name or contract_id' });
  }

  if (tenantRegistry.has(contract_id)) {
    return res.status(409).json({ error: 'Tenant already exists for this contract_id' });
  }

  const tenant = { id: contract_id, name, contract_id };
  tenantRegistry.set(contract_id, tenant);

  return res.status(201).json({ message: 'Tenant provisioned successfully', tenant });
});
