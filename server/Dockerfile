# Khamra POS — app + API in one container. Build from the REPO ROOT context
# (compose sets context: ..) so the image carries the static app as well;
# Caddy terminates HTTPS and proxies the whole hostname here.
FROM node:24-alpine
ENV NODE_ENV=production SERVE_STATIC=1
WORKDIR /app
COPY . .
EXPOSE 8792
CMD ["node", "server/server.js"]
