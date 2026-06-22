FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including dev for build)
COPY package*.json ./
RUN npm install --include=dev

# Build
COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Copy built output and production node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public

EXPOSE 8080

CMD ["node_modules/.bin/next", "start", "-p", "8080"]
