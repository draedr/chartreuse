# ---------- build all workspaces ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 fetches a prebuilt binary; toolchain only needed as fallback
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared/ shared/
COPY server/ server/
COPY web/ web/
RUN npm run build

# ---------- production dependencies only ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev

# ---------- runtime ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    WATCH_CARDS_DIR=/watch/cards \
    WATCH_LOREBOOKS_DIR=/watch/lorebooks \
    RESCAN_INTERVAL_SEC=300 \
    WEB_DIST=/app/web/dist
WORKDIR /app
# node_modules/@chartreuse/shared is a workspace symlink to ../shared
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data /watch/cards /watch/lorebooks && chown -R node:node /data /watch
USER node
EXPOSE 3000
VOLUME /data
CMD ["node", "server/dist/index.js"]
