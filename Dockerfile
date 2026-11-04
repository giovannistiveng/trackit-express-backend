# TrackIt Express · API (Node.js + Express + TypeScript)
# Imagen de producción en tres etapas: dependencias → compilación → ejecución mínima.

ARG NODE_VERSION=22

# ---------- 1. Dependencias (se cachean mientras no cambie package-lock.json)
FROM node:${NODE_VERSION}-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2. Compilación de TypeScript y limpieza de dependencias de desarrollo
FROM dependencias AS compilacion
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 3. Ejecución: solo lo necesario, sin herramientas de compilación, usuario sin privilegios
FROM node:${NODE_VERSION}-alpine AS ejecucion
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_DIR=/app/datos/logs \
    UPLOADS_DIR=/app/datos/uploads \
    VAPID_FILE=/app/datos/vapid.json \
    LOG_TO_CONSOLE=true
WORKDIR /app

COPY --from=compilacion --chown=node:node /app/node_modules ./node_modules
COPY --from=compilacion --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node database ./database
COPY --chown=node:node docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh && mkdir -p /app/datos && chown node:node /app/datos

USER node
VOLUME ["/app/datos"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "dist/infrastructure/http/server.js"]
