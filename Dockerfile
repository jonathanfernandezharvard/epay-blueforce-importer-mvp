# Base on official Playwright Node image
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

ENV NODE_ENV=production
WORKDIR /app

# Install app deps
COPY package.json package-lock.json* .npmrc* ./
RUN npm i --quiet --no-fund --no-audit

# Copy sources
COPY tsconfig.json .
COPY prisma ./prisma
COPY src ./src

# Build
RUN npm run build && npm prune --omit=dev

# Run as non-root
USER pwuser

# Create volumes for data directories
VOLUME ["/data/imports", "/data/screenshots", "/data/state"]

EXPOSE 8080
CMD ["node", "dist/server.js"]
