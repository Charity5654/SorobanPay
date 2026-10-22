FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# ── Runtime image ────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy built node_modules and source from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./
COPY tsconfig.json ./

EXPOSE 3001

# Use dumb-init for correct signal handling (SIGTERM → graceful shutdown)
CMD ["dumb-init", "node", "--require", "ts-node/register/transpile-only", "src/index.ts"]
