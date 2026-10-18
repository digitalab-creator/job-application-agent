FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript && npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 3101
CMD ["node", "dist/index.js"]
