# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ── Stage 2: Build TypeScript ─────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Compile TypeScript → dist/
RUN npx tsc --outDir dist --module commonjs 2>/dev/null || \
    echo "tsc not configured for standalone build — using ts-node at runtime"

# ── Stage 3: Production runner ─────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# Non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 appuser

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source (ts-node runs from source in case tsc build wasn't configured)
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma 2>/dev/null || true

USER appuser
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["npx", "ts-node", "--transpile-only", "src/index.ts"]
