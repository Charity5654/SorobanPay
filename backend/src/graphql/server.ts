import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { resolvers, GraphQLContext } from './resolvers';

export function getSchemaPath(): string {
  const p1 = path.resolve(process.cwd(), 'api/schema.graphql');
  if (fs.existsSync(p1)) return p1;
  return path.resolve(__dirname, '../../api/schema.graphql');
}

export function parseGraphQLContext(req: Request): GraphQLContext {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { isAuthenticated: false };
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
    return {
      isAuthenticated: true,
      user: decoded,
      tenantId: decoded.tenant_id || (req.headers['x-tenant-id'] as string) || null
    };
  } catch (err) {
    return { isAuthenticated: false };
  }
}

export function handleGraphQLRequest(req: Request, res: Response) {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>SorobanPay GraphQL Playground</title>
        <style>body { font-family: sans-serif; background: #121212; color: #fff; padding: 20px; }</style>
      </head>
      <body>
        <h1>SorobanPay GraphQL Playground</h1>
        <p>GraphQL endpoint active at <code>/graphql</code></p>
      </body>
      </html>
    `);
  }

  const context = parseGraphQLContext(req);
  const { query, variables } = req.body || {};

  if (!query) {
    return res.status(400).json({ error: 'GraphQL query required' });
  }

  if (query.includes('subscriptions')) {
    const merchantMatch = query.match(/merchant:\s*"([^"]+)"/) || (variables && variables.merchant ? [null, variables.merchant] : null);
    const merchant = merchantMatch ? merchantMatch[1] : '';

    resolvers.Query.subscriptions(null, { merchant }, context)
      .then(data => res.json({ data: { subscriptions: data } }))
      .catch(err => res.status(401).json({ errors: [{ message: err.message }] }));
  } else if (query.includes('payments')) {
    const merchantMatch = query.match(/merchant:\s*"([^"]+)"/) || (variables && variables.merchant ? [null, variables.merchant] : null);
    const limitMatch = query.match(/limit:\s*(\d+)/) || (variables && variables.limit ? [null, variables.limit] : null);

    const merchant = merchantMatch ? merchantMatch[1] : '';
    const limit = limitMatch ? parseInt(limitMatch[1], 10) : undefined;

    resolvers.Query.payments(null, { merchant, limit }, context)
      .then(data => res.json({ data: { payments: data } }))
      .catch(err => res.status(401).json({ errors: [{ message: err.message }] }));
  } else {
    return res.status(400).json({ errors: [{ message: 'Unsupported or invalid GraphQL operation' }] });
  }
}
