import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { handleGraphQLRequest, getSchemaPath } from '../src/graphql/server';
import { resolvers, paymentPubSub, mockSubscriptions, mockPayments } from '../src/graphql/resolvers';

const app = express();
app.use(express.json());
app.use('/graphql', handleGraphQLRequest);

describe('GraphQL API & Subscriptions (#399 / BE-64)', () => {
  const jwtSecret = 'test-jwt-secret';
  const validToken = jwt.sign({ sub: 'user1', tenant_id: 'default' }, jwtSecret);

  beforeEach(() => {
    process.env.JWT_SECRET = jwtSecret;
  });

  it('should export schema to backend/api/schema.graphql', () => {
    const schemaPath = getSchemaPath();
    expect(fs.existsSync(schemaPath)).toBe(true);
    const content = fs.readFileSync(schemaPath, 'utf8');
    expect(content).toContain('type SubscriptionItem');
    expect(content).toContain('type Payment');
    expect(content).toContain('type Query');
    expect(content).toContain('onNewPayment');
  });

  it('should serve GraphQL Playground on GET /graphql in development', async () => {
    const res = await request(app)
      .get('/graphql')
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('SorobanPay GraphQL Playground');
  });

  it('should reject unauthenticated GraphQL queries', async () => {
    const res = await request(app)
      .post('/graphql')
      .send({ query: '{ subscriptions(merchant: "GMERCHANT1") { id subscriber } }' });

    expect(res.status).toBe(401);
    expect(res.body.errors[0].message).toContain('Unauthorized');
  });

  it('should execute GraphQL subscriptions query with valid JWT', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ query: '{ subscriptions(merchant: "GMERCHANT1") { id subscriber merchant amount status } }' });

    expect(res.status).toBe(200);
    expect(res.body.data.subscriptions.length).toBe(1);
    expect(res.body.data.subscriptions[0].subscriber).toBe('GSUBSCRIBER1');
  });

  it('should execute GraphQL payments query with limit filter', async () => {
    const res = await request(app)
      .post('/graphql')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ query: '{ payments(merchant: "GMERCHANT1", limit: 5) { id txHash amount merchant } }' });

    expect(res.status).toBe(200);
    expect(res.body.data.payments.length).toBe(1);
    expect(res.body.data.payments[0].txHash).toBe('0xhash1');
  });

  it('should support real-time payment subscription pubsub iterator', async () => {
    const context = { isAuthenticated: true, user: { sub: 'user1' } };
    const iterator = resolvers.Subscription.onNewPayment.subscribe(null, { merchant: 'GMERCHANT1' }, context);

    const paymentEvent = {
      id: 'pay_123',
      txHash: '0xhash123',
      amount: '100',
      timestamp: 1700000000,
      status: 'success',
      merchant: 'GMERCHANT1'
    };

    setTimeout(() => {
      paymentPubSub.emit('NEW_PAYMENT', paymentEvent);
    }, 50);

    const resultPromise = iterator.next();
    const result = await resultPromise;

    expect(result.value.onNewPayment.txHash).toBe('0xhash123');
    expect(result.value.onNewPayment.merchant).toBe('GMERCHANT1');
  });
});
