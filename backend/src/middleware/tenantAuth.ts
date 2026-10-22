import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface TenantRequest extends Request {
  tenantId?: string;
  user?: any;
}

export function tenantAuthMiddleware(req: TenantRequest, res: Response, next: NextFunction) {
  let tenantId: string | null = null;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
      req.user = decoded;
      if (decoded.tenant_id) {
        tenantId = decoded.tenant_id;
      }
    } catch (e) {}
  }

  if (!tenantId && req.headers['x-tenant-id']) {
    tenantId = req.headers['x-tenant-id'] as string;
  }

  if (tenantId) {
    req.tenantId = tenantId;
  }
  next();
}

export function requireTenant(req: TenantRequest, res: Response, next: NextFunction) {
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant context required. Provide X-Tenant-ID or JWT claim.' });
  }
  next();
}
