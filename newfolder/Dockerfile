FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production CRM_ENV=production PORT=4173 HOST=0.0.0.0 CRM_DB_PATH=/data/crm.sqlite
COPY package.json ./
COPY server ./server
COPY public ./public
COPY tools ./tools
COPY runbooks ./runbooks
RUN mkdir -p /data && adduser -D -u 10001 crm && chown -R crm:crm /data /app
USER crm
EXPOSE 4173
VOLUME ["/data"]
CMD ["node", "server/index.js"]
