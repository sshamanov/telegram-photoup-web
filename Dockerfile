# photoup — production image: build the static bundle, serve it with a tiny
# Node server. No credentials are baked in; pass them at deploy time:
#   docker run -p 4173:4173 -e TELEGRAM_API_ID=... -e TELEGRAM_API_HASH=... IMAGE
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts svelte.config.js tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node scripts/serve-dist.mjs ./scripts/serve-dist.mjs
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:4173/ || exit 1
CMD ["node", "scripts/serve-dist.mjs"]
