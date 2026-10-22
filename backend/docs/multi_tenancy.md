# Multi-Tenant Architecture & Data Isolation

## Overview
SorobanPay supports hosting backend services for multiple merchant groups and platform deployments.

## Data Isolation Strategy
1. **Tenant Identification**: Each tenant is identified by their deployed smart contract ID (`contract_id`).
2. **Database Level Isolation**: Data tables include a `tenant_id` column.
3. **Request Context**: `tenant_id` is extracted per request from JWT claim (`tenant_id`) or `X-Tenant-ID` header.
4. **Provisioning Endpoint**: Admin-only `POST /v1/admin/tenants` enables onboarding new platform tenants.
