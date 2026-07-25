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

# ---- Stage 4: sync worker ---------------------------------------------------
# A separate image from the same source tree. The worker shares the Prisma
# client and the Akahu gateway with the app but has no HTTP server, no Next.js,
# and no exposed port — it only talks to Postgres and Akahu.
#
# It runs the TypeScript directly through `tsx` rather than compiling to JS
# first. That keeps the generated Prisma client and the `@/*` path aliases
# working exactly as they do in development, with nothing to fall out of sync.
# The cost is shipping full node_modules (tsx is a devDependency), which on a
# homelab is a few tens of megabytes nobody will ever notice.
FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production

# Full dependency tree, unlike the app's standalone runtime — tsx needs to be
# present at run time here, not just at build time.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# src carries the generated Prisma client, produced by `prisma generate`
# during the build stage.
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/package.json /app/tsconfig.json ./

USER node
CMD ["npx", "tsx", "src/worker/index.ts"]
