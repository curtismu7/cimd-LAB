FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts
COPY web web
RUN npm run build -w web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=5250
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server
COPY server/src server/src
COPY stories stories
COPY customer.config.json ./
COPY --from=build /app/web/dist web/dist
# Writes nothing: runs with a read-only root filesystem. No secrets are baked in; PF_BASE_URL etc. come from the environment.
USER node
EXPOSE 5250
HEALTHCHECK --interval=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
