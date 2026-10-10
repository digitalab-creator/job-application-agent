FROM mcr.microsoft.com/playwright:v1.55.1-noble

USER root
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV BUSTER_VERSION=3.4.0

COPY package.json ./
RUN apt-get update && apt-get install -y --no-install-recommends xvfb unzip \
  && rm -rf /var/lib/apt/lists/*
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY scripts/fetch-buster.mjs ./scripts/fetch-buster.mjs
COPY scripts/migrate-tracker-categories.mjs ./scripts/migrate-tracker-categories.mjs
COPY scripts/apply-queue-classification.mjs ./scripts/apply-queue-classification.mjs
COPY scripts/reconcile-historical-queue.mjs ./scripts/reconcile-historical-queue.mjs
COPY scripts/audit-manual-queue.mjs ./scripts/audit-manual-queue.mjs
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
  && node scripts/fetch-buster.mjs
RUN npm run build && npm test
ENV NODE_ENV=production
ENV DISPLAY=:99
ENV BUSTER_EXTENSION_PATH=/app/vendor/buster
ENV CAPTCHA_BUSTER_ENABLED=true

EXPOSE 3000
CMD ["/docker-entrypoint.sh"]
