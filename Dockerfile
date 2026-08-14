# photoup — multi-stage build (build static bundle, serve it)
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
RUN npm install --omit=dev
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:4173/ || exit 1
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
