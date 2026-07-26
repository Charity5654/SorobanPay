-- Seed data for SorobanPay staging environment (k6 load tests — TEST-102)
-- Populates Event table with realistic subscription and payment events
-- so GET /api/subscriptions/merchant/:address returns real data.

-- Example merchant and subscriber addresses (testnet-style)
\set merchant   'GMERCHANT0000000000000000000000000000000000000000000001'
\set subscriber 'GSUBSCRIBER00000000000000000000000000000000000000000001'
\set token_addr 'CABC000TOKEN0000000000000000000000000000000000000000001'

-- Insert subscribe events for 10 subscribers to the same merchant
INSERT INTO "Event" (id, type, subscriber, merchant, token, amount, "ledgerTimestamp", "txHash")
SELECT
  gen_random_uuid()::text,
  'subscribe',
  'GSUB' || LPAD(i::text, 52, '0'),
  'GMERCHANT0000000000000000000000000000000000000000000001',
  'CABC000TOKEN0000000000000000000000000000000000000000001',
  (1000000 * i)::text,
  (extract(epoch from now()) - (i * 86400))::bigint,
  'TX_SUBSCRIBE_' || LPAD(i::text, 10, '0')
FROM generate_series(1, 10) AS i
ON CONFLICT DO NOTHING;

-- Insert executed (payment) events for the same subscribers
INSERT INTO "Event" (id, type, subscriber, merchant, token, amount, "ledgerTimestamp", "txHash")
SELECT
  gen_random_uuid()::text,
  'executed',
  'GSUB' || LPAD(i::text, 52, '0'),
  'GMERCHANT0000000000000000000000000000000000000000000001',
  'CABC000TOKEN0000000000000000000000000000000000000000001',
  (1000000 * i)::text,
  (extract(epoch from now()) - (i * 43200))::bigint,
  'TX_PAYMENT_' || LPAD(i::text, 10, '0')
FROM generate_series(1, 10) AS i
ON CONFLICT DO NOTHING;

-- Create a webhook endpoint for the primary merchant
INSERT INTO "WebhookEndpoint" (id, merchant, url, active, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'GMERCHANT0000000000000000000000000000000000000000000001',
  'https://example.com/webhook/primary',
  true,
  now(),
  now()
) ON CONFLICT DO NOTHING;
