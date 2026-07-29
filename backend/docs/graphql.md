# GraphQL API Specification

## Overview
SorobanPay provides an alternative GraphQL endpoint at `/graphql` alongside the REST API for flexible composite queries and real-time payment event subscriptions via WebSocket (`graphql-ws`).

## Schema Location
The schema is exported to `backend/api/schema.graphql`.

## Authentication
All GraphQL resolvers enforce JWT authentication:
```
Authorization: Bearer <JWT_TOKEN>
```
