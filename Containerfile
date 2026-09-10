# Image d'exécution de l'API et du front.
#
# ATEM-old n'avait qu'une image de *build* : le déploiement réel se faisait en
# neuf étapes manuelles, systemd et nginx. C'est ce que ce fichier remplace.

FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Les manifestes d'abord : tant qu'ils ne changent pas, la couche de
# dépendances est réutilisée et le build ne retélécharge rien.
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

# Pas de root : une faille dans l'application ne doit pas donner la machine.
USER node
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]
