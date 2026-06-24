# Развёртывание (hosted, ТЗ v1.2)

App-сервер + Postgres/pgvector в Docker. Генеративные модели — в OpenRouter,
**GPU не нужен**. Подробные требования к серверу — `docs/hosted_patch1.md` (Часть C).

## Быстрый старт на VPS

Рекомендуемо: 2 vCPU / 4 ГБ RAM / 40 ГБ SSD, Ubuntu 24.04 LTS, обычный IPv4.

```bash
# 1. Поставить Docker + compose (по инструкции docker.com)
# 2. Склонировать проект
git clone https://github.com/MaksimCH-afk/dnd.git && cd dnd

# 3. Создать .env в корне (его читает docker-compose)
cp apps/server/.env.example .env
#   вписать OPENROUTER_API_KEY=...  (опц. ключи по ролям, POSTGRES_PASSWORD)

# 4. Поднять сервер + БД
docker compose up -d --build

# 5. Проверить
curl http://localhost:8787/health
```

## Доступ (приватная игра)

- **Рекомендуется Tailscale** (WireGuard-VPN): сервер не торчит в интернет, портов
  открывать не нужно, трафик шифрован. Открываете `http://<tailscale-ip>:8787`.
- **Публичный доступ** — раскомментируйте сервис `caddy` в `docker-compose.yml`,
  пропишите домен и **обязательно** basic-auth в `deploy/Caddyfile` (иначе боты
  сожгут кредиты OpenRouter и прочитают данные).

## Бэкап

Канон — в Postgres. Периодический дамп по cron:

```bash
docker compose exec -T db pg_dump -U rpg rpg > backup-$(date +%F).sql
```

(можно складывать в git/gdrive/объектное хранилище — ТЗ §15).

## Компоненты

- `apps/server` — app-сервер: движок, состояние (Postgres), эмбеддер, прокси к OpenRouter.
- `db` (pgvector/pgvector:pg16) — Postgres + pgvector.
- Тонкий клиент (`apps/web`) — только UI, общается с сервером (переезд в H3).

## Локальная разработка сервера

```bash
docker run -d --name rpg-pg -e POSTGRES_USER=rpg -e POSTGRES_PASSWORD=rpg \
  -e POSTGRES_DB=rpg -p 5432:5432 pgvector/pgvector:pg16
cp apps/server/.env.example apps/server/.env   # вписать ключ; DATABASE_URL=...localhost...
pnpm --filter @rpg/server dev
```
