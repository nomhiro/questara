# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY app.js package.json ./
COPY routes ./routes
COPY services ./services
COPY middleware ./middleware
COPY views ./views
COPY public ./public
COPY data ./data
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "app.js"]
