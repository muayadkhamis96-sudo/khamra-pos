# Khamra POS API — single-file Node server, no npm install needed.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server.js ./
EXPOSE 8792
CMD ["node", "server.js"]
