# Build-Stage: Verwende ein vollständiges Node 22 LTS-Image zum Bauen (unterstützt native Module wie better-sqlite3)
FROM node:22-bookworm AS builder

WORKDIR /app

# Abhängigkeiten kopieren
COPY package*.json ./

# Alle Abhängigkeiten installieren (inkl. devDependencies wie esbuild, typescript, vite)
RUN npm install --no-fund

# Quellcode kopieren und die Anwendung bauen
COPY . .
RUN npm run build

# Prune devDependencies, um nur produktive Module zu behalten (better-sqlite3 bleibt erhalten und fertig kompiliert)
RUN npm prune --omit=dev

# Runner-Stage: Kleines, optimiertes Node 22 LTS-Image für die Ausführung (gleiche Debian-Bookworm-Basis für native Module)
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Installiere Python 3 (falls lokale Hilfsskripte genutzt werden)
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

# Produktions-Umgebungsvariablen setzen
ENV NODE_ENV=production
ENV PORT=3000

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
