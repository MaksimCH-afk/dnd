# Текстовое НРИ (соло) — hosted-приложение

Текстовая ролевая игра в тёмном фэнтези: вы пишете, что делает герой, а «мастер»
(ИИ через OpenRouter) описывает мир. Все цифры, кости, инвентарь и сюжет считает
**app-сервер** (детерминированный движок + состояние в Postgres); ИИ только
рассказывает. Браузер — **тонкий клиент** (только интерфейс).

Полная спецификация: `docs/TZ.md` (v1.2, hosted). Развёртывание: `docs/deploy.md`.

## Архитектура (hosted)

```
Браузер (тонкий клиент, ПК и планшет)
   │  ход по SSE + API кампаний
   ▼
App-сервер (Docker): движок · состояние (Postgres/pgvector) · эмбеддер · прокси к OpenRouter
   ▼
OpenRouter (генеративные модели; GPU не нужен)
```

- **Источник истины — Postgres** на сервере. Кросс-девайс без ручного синка: ПК и
  планшет открывают одну серверную БД.
- **Ключи OpenRouter, модели, файлы правил, RAG — на сервере** (в клиент не попадают).
- Онлайн обязателен: тонкий клиент без сервера не играет.

## Что понадобится

1. **Сервер** — VPS (рекомендуемо 2 vCPU / 4 ГБ / SSD, Ubuntu) или домашняя
   always-on коробка. GPU не нужен.
2. **Ключ OpenRouter** — [openrouter.ai](https://openrouter.ai) → Keys (есть бесплатные модели).
3. Docker + docker compose на сервере.

## Запуск на сервере (production)

```bash
git clone https://github.com/MaksimCH-afk/dnd.git && cd dnd
cp apps/server/.env.example .env          # вписать OPENROUTER_API_KEY (опц. ключи по ролям)
docker compose up -d --build              # поднимает app-сервер + Postgres/pgvector
curl http://localhost:8787/health         # проверка
```

Затем откройте клиент в браузере и в его настройках укажите адрес сервера
(`http://<адрес-сервера>:8787`). Подробности (Tailscale для приватного доступа,
Caddy+TLS для публичного, бэкапы) — в `docs/deploy.md`.

> **Приватный доступ (рекомендуется):** Tailscale — сервер не торчит в интернет,
> открываете `http://<tailscale-ip>:8787`. **Публичный** — только с аутентификацией
> (Caddy basic-auth), иначе боты сожгут кредиты OpenRouter.

## Игра с планшета

Планшет и сервер — в одной сети (или оба в Tailscale). В браузере планшета откройте
клиент и в ⚙ Настройках укажите адрес сервера. «Добавить на главный экран» — игра
откроется как приложение. Состояние общее с ПК: начали на ПК — продолжили на планшете.

## Команды в игре

- **`/go`** — подтянуть актуальное состояние с сервера (продолжить с другого устройства).
- **`/save`** — зафиксировать сохранение (снапшот на сервере).
- **`/ask`** — мета-режим (скрытая кухня; читает серверный лог хода).

Сверху: **📚** кампании (с сервера), **⚙** настройки. Индикатор ⊙ — связь с сервером.

## Разработка (локально)

```bash
# Postgres с pgvector
docker run -d --name rpg-pg -e POSTGRES_USER=rpg -e POSTGRES_PASSWORD=rpg \
  -e POSTGRES_DB=rpg -p 5432:5432 pgvector/pgvector:pg16

pnpm install
cp apps/server/.env.example apps/server/.env   # OPENROUTER_API_KEY + DATABASE_URL=...localhost...
pnpm dev:server     # app-сервер на :8787
pnpm dev:web        # тонкий клиент на :5173 (в отдельном терминале)
```

Команды: `pnpm -r check` (типы), `pnpm --filter @rpg/engine test` (тесты движка),
`pnpm build` (прод-сборка).

## Структура

```
packages/engine   детерминированный движок (общий; исполняется на сервере)
apps/server       app-сервер: движок, Postgres, эмбеддер, прокси к OpenRouter
apps/web          тонкий клиент (SvelteKit): только UI
rules/            файлы правил мира (бандл сервера)
docs/             TZ.md, ROADMAP.md, deploy.md, models.md, hosted_patch1.md
```

## Установка pnpm (если нужна, для разработки)

```bash
corepack enable      # на macOS при ошибке прав: curl -fsSL https://get.pnpm.io/install.sh | sh -
```
