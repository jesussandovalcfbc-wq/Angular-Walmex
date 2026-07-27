# ═══════════════════════════════════════════════════════════════
# STAGE 1: Build Angular Frontend
# ═══════════════════════════════════════════════════════════════
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Instalar dependencias
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps

# Copiar el resto del código fuente del frontend
COPY frontend/ ./

# Compilar Angular en modo producción
RUN npx ng build --configuration production

# ═══════════════════════════════════════════════════════════════
# STAGE 2: Node.js Backend + servir Angular
# ═══════════════════════════════════════════════════════════════
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del backend
COPY backend-node/package*.json ./
RUN npm install --omit=dev

# Copiar código del backend
COPY backend-node/ ./

# Copiar los archivos de Angular compilados en la carpeta 'public'
COPY --from=frontend-builder /app/frontend/dist/frontend/browser ./public

# Exponer el puerto
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:8000/api/health || exit 1

# Arrancar el servidor con tsx
CMD ["npx", "tsx", "src/server.ts"]
