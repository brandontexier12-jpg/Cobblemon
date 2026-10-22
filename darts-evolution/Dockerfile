# DARTS EVOLUTION — image Docker reproductible (dépendances figées par package-lock.json).
# Compatible avec le moteur de construction classique comme avec BuildKit (aucune syntaxe spécifique).
# Aucune dépendance native : la même image fonctionne sur NAS x86-64 et ARM64 (build multi-architecture possible).

ARG NODE_IMAGE=node:22.22.0-alpine3.23

# ---------- Étape 1 : installation, tests, construction ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/statistics/package.json packages/statistics/
COPY packages/autodarts-adapter/package.json packages/autodarts-adapter/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
# Les tests s'exécutent pendant la construction : une image n'est produite que si tout passe.
# Pour une construction plus rapide sur un petit NAS : --build-arg RUN_TESTS=false
ARG RUN_TESTS=true
RUN if [ "$RUN_TESTS" = "true" ]; then npm test; fi
RUN npm run build

# ---------- Étape 2 : image d'exécution minimale ----------
FROM ${NODE_IMAGE} AS runtime
ARG APP_VERSION=1.2.0
LABEL org.opencontainers.image.title="DARTS EVOLUTION" \
      org.opencontainers.image.description="Fléchettes : scoring, entraînements, statistiques, compétitions, intégration Autodarts" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production \
    APP_PORT=8080 \
    APP_HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/darts-evolution.db \
    BACKUP_PATH=/app/backups \
    WEB_DIST_PATH=/app/web \
    TZ=Europe/Paris \
    PUID=1000 \
    PGID=1000
WORKDIR /app
COPY --from=build /src/apps/server/dist/ ./server/
COPY --from=build /src/apps/web/dist/ ./web/
COPY --from=build /src/apps/server/dist/launcher.mjs ./launcher.mjs
COPY docker/healthcheck.mjs ./
RUN mkdir -p /app/data /app/backups
EXPOSE 8080
VOLUME ["/app/data", "/app/backups"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
# Le lanceur abandonne les droits root (PUID/PGID) puis supervise le serveur : redémarrage après une mise à
# jour installée depuis l'application, retour automatique à la version précédente si elle ne démarre pas.
# L'arrêt propre (SIGTERM) est transmis au serveur. Le fuseau horaire (TZ) est pris en charge par l'ICU intégré à Node.
ENTRYPOINT ["node", "--disable-warning=ExperimentalWarning", "--enable-source-maps", "--max-old-space-size=256", "/app/launcher.mjs"]
