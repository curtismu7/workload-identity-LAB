FROM node:26-alpine
WORKDIR /app
COPY package*.json ./
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root || npm install
COPY . .
RUN cd web && npm run build
ENV PORT=7816
# The Real button saves the connection here. A named volume mounted on /data inherits this ownership.
ENV WI_CONFIG_DIR=/data
RUN mkdir -p /data && chown node:node /data
EXPOSE 7816
USER node
CMD ["node", "server/src/index.js"]
