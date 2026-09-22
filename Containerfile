# Runtime image of the API.
#
# Built for amd64 and arm64. The build stage runs on the builder's own platform
# (`$BUILDPLATFORM`): TypeScript and Vite produce JavaScript, the same for
# every architecture, so compiling under emulation would only be slower. Only
# the runtime stage is assembled per architecture — its production
# dependencies are pure JavaScript, with no native module to compile.

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
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
# `@atem/shared` is built too, and that is not a detail: its package points at
# `./src/index.ts`, which suits `tsx` in development and nothing at all in this
# image. Without this the container never started — Node loaded the TypeScript
# entry point, then failed on its first `./set-code.js`, which existed only as
# `.ts`. Measured on 2026-09-16 by bringing the stack up: migrate exited 1,
# ERR_MODULE_NOT_FOUND, and the API behind it.
RUN pnpm --filter @atem/shared build \
 && pnpm --filter @atem/api build

# The entry point the **image** uses, derived from the real manifest rather than
# written a second time: a hand-kept copy would drift on the first dependency
# added, and drift silently.
RUN node -e "const p=require('/app/packages/shared/package.json'); \
  p.main='./dist/index.js'; p.exports={'.':'./dist/index.js'}; \
  require('fs').writeFileSync('/app/packages/shared/package.runtime.json', JSON.stringify(p,null,2));"

# ---

# The production dependencies, for the target platform — pure JavaScript, but
# installed where they will run all the same.
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @atem/api...

# ---

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="ATEM API" \
      org.opencontainers.image.source="https://github.com/Altagen/ATEM" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production

# No package manager in the running image: the API installs nothing, and npm,
# corepack and yarn — with their own dependencies — were every vulnerability
# the image scanner found in it (2026-09-22).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/api/node_modules apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules packages/shared/node_modules

# Compiled JavaScript, and the manifest that points at it — never the sources.
# The front is not here: nginx serves it, from its own image (Containerfile.web).
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.runtime.json packages/shared/package.json
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle

# The media directory belongs to the unprivileged user. A named volume mounted
# there takes the image's ownership on first use; created at mount time
# instead, it would be root's, and no card image could ever be written.
RUN mkdir -p /app/data/media && chown -R node:node /app/data

# No root: a flaw in the application must not hand over the machine.
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
