FROM node:26-alpine
WORKDIR /app
COPY package*.json ./
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root || npm install
COPY . .
RUN cd web && npm run build
ENV PORT=7816
EXPOSE 7816
USER node
CMD ["node", "server/src/index.js"]
