# App-сервер (hosted). Генеративные модели — в OpenRouter, GPU не нужен.
FROM node:20-slim

# pnpm через corepack
RUN corepack enable

WORKDIR /app

# Манифесты воркспейса (для кеша установки)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/

# Устанавливаем зависимости только сервера и движка
RUN pnpm install --filter @rpg/server... --frozen-lockfile || pnpm install --filter @rpg/server...

# Исходники
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY rules rules

ENV PORT=8787
EXPOSE 8787

# Запуск через tsx (исходники TS, без отдельной сборки)
CMD ["pnpm", "--filter", "@rpg/server", "start"]
