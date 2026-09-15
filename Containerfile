# Runtime image of the API and the front.
#
# ATEM-old only had a *build* image: the real deployment took nine manual
# steps, systemd and nginx. That is what this file replaces.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Manifests first: as long as they do not change, the dependency layer is
# reused and the build downloads nothing again.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @atem/api build && pnpm --filter @atem/web build

# ---

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @atem/api...

COPY --from=build /app/packages/shared/src packages/shared/src
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist

# The media directory belongs to the unprivileged user. A named volume mounted
# there takes the image's ownership on first use; created at mount time
# instead, it would be root's, and no card image could ever be written.
RUN mkdir -p /app/data/media && chown -R node:node /app/data

# No root: a flaw in the application must not hand over the machine.
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
