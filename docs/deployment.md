# SorobanPay — Production Deployment Guide

This guide covers every step required to deploy SorobanPay to a production environment, from pre-flight checks through mainnet contract deployment, frontend hosting, backend services, monitoring, and rollback procedures.

> **Prerequisite reading:** [README.md → Deployment](../README.md#deployment) covers basic testnet deployment. This document picks up where the README leaves off and focuses on production hardening.

---

## Table of Contents

1. [Pre-deployment Checklist](#1-pre-deployment-checklist)
2. [Mainnet Contract Deployment](#2-mainnet-contract-deployment)
3. [Frontend Deployment](#3-frontend-deployment)
   - [Vercel](#31-vercel)
   - [Netlify](#32-netlify)
   - [Self-hosted Nginx](#33-self-hosted-nginx)
4. [Backend Deployment](#4-backend-deployment)
   - [Docker Compose (single server)](#41-docker-compose-single-server)
   - [Kubernetes (multi-server)](#42-kubernetes-multi-server)
   - [AWS ECS (Fargate)](#43-aws-ecs-fargate)
5. [Environment Variable Reference](#5-environment-variable-reference)
6. [Key Management](#6-key-management)
7. [Monitoring Setup](#7-monitoring-setup)
8. [Rollback Procedures](#8-rollback-procedures)

---

## 1. Pre-deployment Checklist

Complete every item before touching mainnet.

### Contract

- [ ] All unit tests pass: `make test`
- [ ] Property-based tests pass (time-lock, double-payment prevention, balance invariant)
- [ ] Contract reviewed for reentrancy, integer overflow, and auth bypass
- [ ] Third-party audit completed (strongly recommended before significant value is at risk)
- [ ] Contract tested end-to-end on **testnet** with real Freighter wallets
- [ ] WASM binary size reviewed — ensure `opt-level = "z"` and `lto = true` are set in `Cargo.toml`

### Keys and Identity

- [ ] A dedicated mainnet Stellar identity created (not shared with testnet)
- [ ] Private key backed up to at least two secure offline locations (see [Key Management](#6-key-management))
- [ ] Identity funded with enough XLM for deployment fees (minimum 10 XLM recommended; see [Mainnet fees](#21-fee-fund-amount))
- [ ] No private keys committed to the repository (run `git log --all -S "SECRET" -- '*.toml' '*.json' '*.env'`)

### Frontend

- [ ] `npm run type-check` passes with zero errors
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds locally
- [ ] All environment variables reviewed and classified (see [Environment Variable Reference](#5-environment-variable-reference))
- [ ] `NEXT_PUBLIC_CONTRACT_ID` set to the **mainnet** contract address (not testnet)

### Infrastructure

- [ ] HTTPS / TLS certificate provisioned for the frontend domain
- [ ] Domain DNS configured and propagated
- [ ] Secrets stored in a secret manager (not in `.env` files on disk)
- [ ] Monitoring and alerting configured before go-live

---

## 2. Mainnet Contract Deployment

### 2.1 Fee Fund Amount

Deploying a Soroban contract to mainnet costs approximately:

| Operation | Estimated fee |
|-----------|--------------|
| Contract upload (WASM) | ~0.01–0.05 XLM |
| Contract instantiation | ~0.001–0.01 XLM |
| Account minimum reserve | 1 XLM base + 0.5 XLM per subentry |

**Recommended minimum fund: 10 XLM** on the deployer account to cover fees and reserve requirements comfortably.

### 2.2 Step-by-Step Deployment

```bash
# 1. Generate a dedicated mainnet identity (one-time)
stellar keys generate sorobanpay-prod --network mainnet

# 2. Verify the identity was created
stellar keys address sorobanpay-prod

# 3. Fund the account (you must send XLM from an exchange or another wallet)
#    The address printed by the previous command is your funding target.

# 4. Build the WASM (always build fresh for mainnet)
make clean
make build

# 5. Deploy to mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=sorobanpay-prod bash deploy/deploy.sh

# 6. Record the contract address printed to stdout
#    Example output: CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
CONTRACT_ID="<address from step 5>"
echo "Contract deployed: $CONTRACT_ID"
```

### 2.3 Verify Deployment

```bash
# Invoke a read-only check — should return an error like NoActiveSubscription
# (which confirms the contract is live and reachable)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network mainnet \
  --source sorobanpay-prod \
  -- \
  cancel \
  --subscriber GABC123... \
  --merchant GABC456...
```

Expected: contract error `NoActiveSubscription` (error code 4) — confirms the contract is deployed and entry points are callable.

---

## 3. Frontend Deployment

Set these environment variables in your hosting platform's secrets panel before deploying. Never put the values directly in code or committed files.

```env
NEXT_PUBLIC_CONTRACT_ID=<mainnet contract address>
NEXT_PUBLIC_RPC_URL=https://soroban-mainnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### 3.1 Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Link to your project (one-time)
cd frontend
vercel link

# Set environment variables
vercel env add NEXT_PUBLIC_CONTRACT_ID production
vercel env add NEXT_PUBLIC_RPC_URL production
vercel env add NEXT_PUBLIC_NETWORK_PASSPHRASE production

# Deploy to production
vercel --prod
```

Or connect the GitHub repository in the Vercel dashboard and set environment variables under **Project → Settings → Environment Variables**. Vercel will deploy automatically on every push to `main`.

### 3.2 Netlify

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Log in
netlify login

# Link to your site (one-time)
cd frontend
netlify link

# Set environment variables
netlify env:set NEXT_PUBLIC_CONTRACT_ID "<value>"
netlify env:set NEXT_PUBLIC_RPC_URL "https://soroban-mainnet.stellar.org"
netlify env:set NEXT_PUBLIC_NETWORK_PASSPHRASE "Public Global Stellar Network ; September 2015"

# Deploy
netlify deploy --prod --dir=.next
```

Add a `netlify.toml` in the `frontend/` directory:

```toml
[build]
  command   = "npm run build"
  publish   = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

### 3.3 Self-hosted Nginx

**Build the static export or Node server:**

```bash
cd frontend
npm ci
npm run build
```

**Nginx configuration** (`/etc/nginx/sites-available/sorobanpay`):

```nginx
server {
    listen 80;
    server_name sorobanpay.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sorobanpay.example.com;

    ssl_certificate     /etc/letsencrypt/live/sorobanpay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sorobanpay.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "DENY";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-eval'; connect-src 'self' https://soroban-mainnet.stellar.org; style-src 'self' 'unsafe-inline'";

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Run the Next.js server as a systemd service** (`/etc/systemd/system/sorobanpay.service`):

```ini
[Unit]
Description=SorobanPay Next.js frontend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/sorobanpay/frontend
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/sorobanpay/.env.production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable sorobanpay
sudo systemctl start sorobanpay
```

---

## 4. Backend Deployment

If you run a payment indexer, webhook dispatcher, or analytics backend alongside the frontend, use one of the following configurations.

### 4.1 Docker Compose (single server)

**`docker-compose.prod.yml`:**

```yaml
version: "3.9"

services:
  frontend:
    image: sorobanpay-frontend:latest
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - .env.production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  indexer:
    image: sorobanpay-indexer:latest
    build:
      context: ./indexer
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - STELLAR_RPC_URL=${NEXT_PUBLIC_RPC_URL}
      - CONTRACT_ID=${NEXT_PUBLIC_CONTRACT_ID}
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=sorobanpay
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - frontend
    restart: unless-stopped

volumes:
  pgdata:
```

**Deploy:**

```bash
# Build images
docker compose -f docker-compose.prod.yml build

# Start all services
docker compose -f docker-compose.prod.yml up -d

# Tail logs
docker compose -f docker-compose.prod.yml logs -f
```

### 4.2 Kubernetes (multi-server)

A minimal Kubernetes manifest for the frontend deployment:

**`k8s/frontend-deployment.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sorobanpay-frontend
  namespace: sorobanpay
spec:
  replicas: 2
  selector:
    matchLabels:
      app: sorobanpay-frontend
  template:
    metadata:
      labels:
        app: sorobanpay-frontend
    spec:
      containers:
        - name: frontend
          image: sorobanpay-frontend:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: sorobanpay-secrets
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: sorobanpay-frontend
  namespace: sorobanpay
spec:
  selector:
    app: sorobanpay-frontend
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

**Create the secrets:**

```bash
kubectl create secret generic sorobanpay-secrets \
  --namespace sorobanpay \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="<value>" \
  --from-literal=NEXT_PUBLIC_RPC_URL="https://soroban-mainnet.stellar.org" \
  --from-literal=NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

kubectl apply -f k8s/
```

### 4.3 AWS ECS (Fargate)

```bash
# 1. Push image to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com

docker build -t sorobanpay-frontend ./frontend
docker tag sorobanpay-frontend:latest <account>.dkr.ecr.us-east-1.amazonaws.com/sorobanpay-frontend:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/sorobanpay-frontend:latest

# 2. Store secrets in AWS Secrets Manager (never in task definition plaintext)
aws secretsmanager create-secret \
  --name sorobanpay/production \
  --secret-string '{"NEXT_PUBLIC_CONTRACT_ID":"<value>","NEXT_PUBLIC_RPC_URL":"https://soroban-mainnet.stellar.org"}'

# 3. Register a task definition that references the secret ARN
# (see AWS docs: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-app-secrets-manager.html)

# 4. Create or update the ECS service
aws ecs update-service \
  --cluster sorobanpay-prod \
  --service sorobanpay-frontend \
  --force-new-deployment
```

---

## 5. Environment Variable Reference

All environment variables across all services, with security classification.

| Variable | Service | Classification | Description |
|----------|---------|---------------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | Frontend | **Public** | Deployed contract address. Baked into the client bundle at build time. |
| `NEXT_PUBLIC_RPC_URL` | Frontend | **Public** | Soroban RPC endpoint. Testnet: `https://soroban-testnet.stellar.org`. Mainnet: `https://soroban-mainnet.stellar.org`. |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Frontend | **Public** | Stellar network passphrase. Testnet: `Test SDF Network ; September 2015`. Mainnet: `Public Global Stellar Network ; September 2015`. |
| `STELLAR_NETWORK` | Deploy script | **Public** | `testnet` or `mainnet`. Controls which Stellar network `deploy.sh` targets. Default: `testnet`. |
| `STELLAR_IDENTITY` | Deploy script | **Public** | Stellar CLI identity alias used for deployment signing. Default: `alice`. |
| `DATABASE_URL` | Backend indexer | **Secret** | PostgreSQL connection string. Format: `postgres://user:pass@host:5432/dbname`. Never log or expose. |
| `POSTGRES_USER` | Database | **Secret** | PostgreSQL superuser name for the database container. |
| `POSTGRES_PASSWORD` | Database | **Secret** | PostgreSQL superuser password. Use a random 32+ character string. |
| `WEBHOOK_SECRET` | Backend | **Secret** | HMAC secret for signing outbound webhook payloads. Rotate periodically. |
| `INDEXER_PRIVATE_KEY` | Backend indexer | **Secret** | Stellar private key used by the indexer to call `execute_payment`. Store in HSM or secret manager. **Never commit.** |

> **Security rule:** Variables marked **Secret** must never be committed to source control, printed in logs, or stored in unencrypted files. Use a secret manager (AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, or similar).

---

## 6. Key Management

### Never Commit Private Keys

```bash
# Add to .gitignore
echo "*.key" >> .gitignore
echo ".env.local" >> .gitignore
echo ".env.production" >> .gitignore

# Scan for accidental commits
git log --all --full-history -- '**/*.env*'
git secrets --scan  # requires git-secrets tool
```

### Production Key Storage Options

**Option A — Hardware Security Module (HSM)**
Best for high-value deployments. The private key never leaves the HSM. Sign transactions by passing the transaction envelope to the HSM API.

**Option B — AWS Secrets Manager / GCP Secret Manager / Azure Key Vault**
Store the Stellar private key as a secret. Your backend retrieves it at runtime via the cloud provider's SDK. Enable rotation policies.

**Option C — Stellar CLI encrypted key store**
The Stellar CLI stores keys encrypted on disk. Acceptable for testnet; use HSM or cloud secret manager for mainnet production.

```bash
# Export a key to move it to a secret manager (do this offline)
stellar keys show sorobanpay-prod
# Immediately clear terminal history after
history -c
```

### Key Rotation

1. Generate a new identity: `stellar keys generate sorobanpay-prod-v2 --network mainnet`
2. Fund the new account
3. Update any backend services that reference the old key
4. Revoke / archive the old key after confirming the new one works

---

## 7. Monitoring Setup

### 7.1 Prometheus + Grafana

Export metrics from your backend indexer and hook Prometheus scrape configs to them.

**`prometheus.yml` (relevant scrape config):**

```yaml
scrape_configs:
  - job_name: sorobanpay-indexer
    static_configs:
      - targets: ["indexer:9090"]
    metrics_path: /metrics

  - job_name: sorobanpay-frontend
    static_configs:
      - targets: ["frontend:3000"]
    metrics_path: /api/metrics
```

**Key metrics to track:**

| Metric | Alert threshold |
|--------|----------------|
| `execute_payment_success_total` | Drop > 20% from rolling average |
| `execute_payment_failure_total` | Spike > 5 failures/min |
| `indexer_lag_seconds` | > 60 seconds behind chain |
| `frontend_http_errors_total` | 5xx rate > 1% |
| `stellar_rpc_latency_p95` | > 2 seconds |

**Run Grafana + Prometheus via Docker Compose:**

```yaml
# Add to docker-compose.prod.yml
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
```

### 7.2 PagerDuty Integration

1. Create a PagerDuty service and copy the **Integration Key**.
2. Add an alertmanager rule that routes Prometheus alerts to PagerDuty:

```yaml
# alertmanager.yml
receivers:
  - name: pagerduty
    pagerduty_configs:
      - routing_key: "<your-integration-key>"
        description: "SorobanPay alert: {{ .CommonAnnotations.summary }}"

route:
  receiver: pagerduty
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

3. Test the integration: `amtool alert add alertname="test" severity="critical"`

---

## 8. Rollback Procedures

### 8.1 Contract Rollback

Soroban contracts cannot be "rolled back" in the traditional sense — once a contract is deployed at an address and has state, you cannot revert that state on-chain.

**If the new contract version is broken:**

1. **Stop pointing new subscribers at the broken contract** — update the frontend's `NEXT_PUBLIC_CONTRACT_ID` to the old contract address immediately (this is a frontend-only change and can be done in minutes via Vercel/Netlify dashboard).
2. **Existing subscriptions on the broken contract** — merchants should stop calling `execute_payment` on the broken contract until the issue is resolved or a patched contract is deployed.
3. **Deploy a patched contract** — follow the [Mainnet Contract Deployment](#2-mainnet-contract-deployment) steps to deploy a fixed version, then re-onboard subscribers.

### 8.2 Frontend Rollback

**Vercel:**

```bash
# List recent deployments
vercel ls

# Promote a previous deployment to production
vercel promote <deployment-url>
```

**Netlify:**

In the Netlify dashboard: **Deploys → [previous deploy] → Publish deploy**.

**Self-hosted / Docker:**

```bash
# Tag the previous working image before deploying new versions
docker tag sorobanpay-frontend:latest sorobanpay-frontend:stable

# Roll back
docker compose -f docker-compose.prod.yml stop frontend
docker tag sorobanpay-frontend:stable sorobanpay-frontend:latest
docker compose -f docker-compose.prod.yml up -d frontend
```

**Kubernetes:**

```bash
# Roll back the frontend deployment to the previous revision
kubectl rollout undo deployment/sorobanpay-frontend -n sorobanpay

# Check rollout status
kubectl rollout status deployment/sorobanpay-frontend -n sorobanpay
```

### 8.3 Database Migration Rollback

If your backend indexer applies database migrations, ensure every migration has a corresponding `down` migration script.

```bash
# Using a migration tool (e.g., golang-migrate or Flyway)
# Roll back the last migration
migrate -path ./migrations -database "$DATABASE_URL" down 1

# Verify current version
migrate -path ./migrations -database "$DATABASE_URL" version
```

**Best practices:**

- Always back up the database before applying migrations: `pg_dump -Fc sorobanpay > backup_$(date +%Y%m%d_%H%M%S).dump`
- Test `down` migrations in a staging environment before deploying to production
- Never drop columns or tables in a migration without a retention period first (mark as deprecated, clean up in a later migration)

---

## References

- [README.md → Deployment](../README.md#deployment)
- [Stellar CLI documentation](https://developers.stellar.org/docs/tools/stellar-cli)
- [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts)
- [Stellar network passphrases](https://developers.stellar.org/docs/learn/fundamentals/networks)
- [Vercel Next.js deployment](https://vercel.com/docs/frameworks/nextjs)
- [Netlify Next.js plugin](https://docs.netlify.com/integrations/frameworks/next-js/overview/)
