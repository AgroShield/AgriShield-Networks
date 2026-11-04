# Multi-stage Docker build for AgriShield Frontend Console
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json tsconfig*.json vite.config.ts index.html ./

# Install dependencies
RUN npm ci

# Copy frontend source files
COPY src ./src

# Build production SPA assets
RUN npm run build

# Web server stage using lightweight Nginx Alpine
FROM nginx:1.25-alpine AS runner

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
