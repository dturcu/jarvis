FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY packages/*/package.json ./packages/
RUN npm ci --ignore-scripts 2>/dev/null || npm install

# Copy source
COPY . .

# Build TypeScript + dashboard
RUN npm run build
RUN npm run dashboard:build 2>/dev/null || true

# Initialize databases
RUN npx tsx scripts/init-jarvis.ts

EXPOSE 4242

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:4242/api/ready || exit 1

CMD ["node", "scripts/start.mjs"]
