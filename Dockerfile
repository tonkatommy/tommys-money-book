# Multi-stage build: each stage starts fresh and only copies forward what it
# needs, so the final image ships the compiled app without node_modules,
# source, or build tooling.

# ---- Stage 1: install dependencies ----------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
# Copy only the manifests first — Docker caches this layer, so dependencies
# aren't reinstalled unless package*.json actually changes.
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build ---------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` runs `prisma generate` first (see package.json), which
# creates the typed client in src/generated/prisma. Neither step needs a
# live database.
RUN npm run build

# ---- Stage 3: runtime -------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Run as the non-root user that ships with the node image.
USER node

# `output: "standalone"` in next.config.ts makes the build emit a minimal
# server with only the node_modules it actually uses.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
