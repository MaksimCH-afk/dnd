# App-сервер (hosted) + встроенный тонкий клиент. GPU не нужен — модели в OpenRouter.
# Образ собирает веб-клиент (apps/web) и раздаёт его тем же сервером (единый origin).

# --- Этап 1: сборка тонкого клиента (статика) ---
FROM node:20-slim AS web
RUN corepack enable
WORKDIR /app

# Манифесты воркспейса (кеш установки)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/engine/package.json packages/engine/
COPY apps/web/package.json apps/web/

# Зависимости веб-клиента (+ движок как зависимость)
RUN pnpm install --filter @rpg/web... --frozen-lockfile || pnpm install --filter @rpg/web...

# Исходники и прод-сборка → apps/web/build
COPY packages/engine packages/engine
COPY apps/web apps/web
RUN pnpm --filter @rpg/web build

# --- Этап 2: рантайм app-сервера ---
FROM node:20-slim
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/

# Зависимости только сервера и движка
RUN pnpm install --filter @rpg/server... --frozen-lockfile || pnpm install --filter @rpg/server...

# Исходники сервера/движка/правил
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY rules rules

# Собранный клиент из этапа 1 + указатель на каталог статики
COPY --from=web /app/apps/web/build ./web
ENV WEB_DIR=/app/web

ENV PORT=8787
EXPOSE 8787

# Запуск через tsx (исходники TS, без отдельной сборки сервера)
CMD ["pnpm", "--filter", "@rpg/server", "start"]
