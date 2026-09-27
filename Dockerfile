FROM mcr.microsoft.com/playwright:v1.55.1-noble

USER root
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
RUN npm run build && npm test
ENV NODE_ENV=production
ENV DISPLAY=:99

EXPOSE 3000
CMD ["/docker-entrypoint.sh"]
