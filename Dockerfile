# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# CSS ビルド専用ステージ（devDependencies の Tailwind CLI が必要）。
# 成果物 public/app.css のみを runtime へ持ち込み、CLI は本番イメージに混入させない。
FROM node:20-alpine AS cssbuild
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY views ./views
RUN npm run build:css

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
# public/ の中身は Tailwind 生成物 app.css のみ（.gitignore 対象でリポジトリに無い）。
# CI のチェックアウトには public/ が存在せず COPY が失敗するため、生成物だけを cssbuild から取り込む。
COPY --from=cssbuild /app/public/app.css ./public/app.css
COPY data ./data
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "app.js"]
