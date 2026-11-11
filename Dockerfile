# Build the front end
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

# Run the server
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev && npm cache clean --force && rm -rf public
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
