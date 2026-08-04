FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
COPY frontend ./frontend
COPY public ./public
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
RUN mkdir /data && chown node:node /data
ENV DATABASE_PATH=/data/fashion-canvas.sqlite \
    ADMIN_USERNAME_FILE=/run/secrets/admin_username \
    ADMIN_PASSWORD_FILE=/run/secrets/admin_password
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/src/server.js"]
