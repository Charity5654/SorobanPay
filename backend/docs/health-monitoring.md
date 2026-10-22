# Health Check & Probe Endpoints

## Overview
SorobanPay services expose unauthenticated health check endpoints for load balancers and container orchestrators (Kubernetes, ECS).

## Endpoints

### 1. `GET /health`
Returns 200 HTTP OK if all backend dependencies are operational, or 503 Service Unavailable if degraded.

**Sample Response (200 OK):**
```json
{
  "status": "healthy",
  "uptime": 12345,
  "dependencies": {
    "postgres": "healthy",
    "redis": "healthy",
    "stellar_rpc": "healthy",
    "indexer_lag_seconds": 12
  }
}
```

### 2. `GET /health/ready` (Readiness Probe)
Returns 200 OK once initial database migrations have completed and the first Stellar RPC poll has succeeded. Returns 503 during startup or migration lock.

### 3. `GET /health/live` (Liveness Probe)
Returns 200 OK as long as the process HTTP loop is responding. Used by container orchestrators to trigger process restarts if deadlocked.
