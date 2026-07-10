# Card Majlis — container image WITH ffmpeg, so the server avatar-upload feature
# (POST /api/me/avatar → 192×192 EXIF-stripped WebP) works in production. This is
# OPTIONAL: the native Render path (render.yaml, runtime: node) still works exactly
# as before but has NO ffmpeg, so uploads return a clean 503. See RENDER_DEPLOY.md
# for the click-by-click switch to a Docker runtime.
#
# Node 22 + npm 10 (matches the CI toolchain policy — node:22 ships npm 10, so
# `npm ci` honours the committed lockfile without the npm-11 libc churn). The server
# runs the TypeScript directly via tsx (there is no compiled server output), so all
# deps (incl. tsx) stay installed — dev deps are NOT pruned. No secrets are baked in.

FROM node:22-bookworm-slim

# ffmpeg: the ONLY reason this image exists (image decode → WebP for avatar upload).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching (only re-runs when the lockfile changes).
COPY package.json package-lock.json ./
RUN npm ci

# App source + build the static client (dist/ is served by the same Node server).
COPY . .
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0
# PORT is injected by the host (Render). The server binds process.env.PORT; EXPOSE is
# documentation only (the default local port).
EXPOSE 3001

# The SAME production command the native deploy uses (tsx runs server/index.ts).
CMD ["npm", "run", "server:prod"]
