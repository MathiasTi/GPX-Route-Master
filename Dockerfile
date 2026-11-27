# Build-Stage: Verwende ein vollständiges Node 22 LTS-Image zum Bauen (unterstützt native Module wie better-sqlite3)
FROM node:22-bookworm AS builder

WORKDIR /app

ARG APP_GIT_COMMIT=unknown
ARG APP_GIT_BRANCH=unknown
ARG APP_BUILD_TIME=unknown

# Abhängigkeiten kopieren
COPY package*.json ./

# Alle Abhängigkeiten installieren (inkl. devDependencies wie esbuild, typescript, vite)
RUN npm install --no-fund

# Quellcode kopieren und die Anwendung bauen
COPY . .
RUN npm run build && node -e 'const fs = require("fs"); fs.writeFileSync("/app/dist/build-info.json", JSON.stringify({ commit: process.env.APP_GIT_COMMIT || "unknown", branch: process.env.APP_GIT_BRANCH || "unknown", buildTime: process.env.APP_BUILD_TIME || new Date().toISOString() }, null, 2));'

# Prune devDependencies, um nur produktive Module zu behalten (better-sqlite3 bleibt erhalten und fertig kompiliert)
RUN npm prune --omit=dev

# Runner-Stage: Kleines, optimiertes Node 22 LTS-Image für die Ausführung (gleiche Debian-Bookworm-Basis für native Module)
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ARG APP_GIT_COMMIT=unknown
ARG APP_GIT_BRANCH=unknown
ARG APP_BUILD_TIME=unknown

# Installiere Python 3 (falls lokale Hilfsskripte genutzt werden)
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

# Produktions-Umgebungsvariablen setzen
ENV NODE_ENV=production
ENV PORT=3000
ENV APP_GIT_COMMIT=${APP_GIT_COMMIT}
ENV APP_GIT_BRANCH=${APP_GIT_BRANCH}
ENV APP_BUILD_TIME=${APP_BUILD_TIME}

# Kopiere die produktiven Abhängigkeiten, gebauten Server und Assets aus der Build-Stage
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/utils ./utils

# Definiere das Datenverzeichnis als permanentes Volume für SQLite-Datenbanken und Garmin-Backups
VOLUME ["/app/data"]

# Port 3000 nach außen freigeben
EXPOSE 3000

# Startet den integrierten Express & Vite Production-Server
CMD ["npm", "start"]
