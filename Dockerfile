# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (like tree-sitter)
RUN apk add --no-cache python3 make g++ 

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV production
# Install runtime dependencies for native modules if needed
RUN apk add --no-cache libc6-compat

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static

# Note: For the worker process, we also need the full src/queue/worker.ts built or executed via ts-node,
# but the easiest way is to copy node_modules and src if you are not using a separate TS build step for the worker.
# To keep this Next.js centric:
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

ENV PORT 3000
# set hostname to localhost
ENV HOSTNAME "0.0.0.0"

CMD ["node", "server.js"]
