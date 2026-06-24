# Развёртывание (hosted, ТЗ v1.2)

App-сервер (+ встроенный веб-клиент) + Postgres/pgvector в Docker. Генеративные
модели — в OpenRouter, **GPU не нужен**. UI и API — на одном порту **8787**:
после старта игра открывается в браузере по `http://<сервер>:8787/`, отдельно
хостить клиент и вводить адрес сервера не нужно.

## Быстрый старт на VPS

Рекомендуемо: 2 vCPU / 4 ГБ RAM / 40 ГБ SSD, Ubuntu 24.04 LTS, обычный IPv4.

```bash
# 1. Поставить Docker + compose (по инструкции docker.com)
# 2. Склонировать проект
git clone https://github.com/MaksimCH-afk/dnd.git && cd dnd

# 3. Создать .env в корне (его читает docker-compose)
cp apps/server/.env.example .env
#   вписать OPENROUTER_API_KEY=...  (опц. ключи по ролям, POSTGRES_PASSWORD)

# 4. Собрать и поднять (первая сборка качает образы и собирает клиент — несколько минут)
docker compose up -d --build

# 5. Проверить
curl http://localhost:8787/health     # API
#   и открыть http://<IP-сервера>:8787/ в браузере — это сам клиент
```

> Первый ход после старта может «думать» дольше обычного: сервер один раз
> скачивает модель эмбеддера RAG (bge-m3, ~1–2 ГБ) и кеширует её в томе.

## Конкретный прогон (Ubuntu, root) — пошагово

```bash
# Docker (официальный скрипт)
curl -fsSL https://get.docker.com | sh

git clone https://github.com/MaksimCH-afk/dnd.git && cd dnd
# Текущая разработка — в ветке claude/bold-bohr-zpjzbw (пока не слита в main):
git checkout claude/bold-bohr-zpjzbw

cp apps/server/.env.example .env
nano .env            # OPENROUTER_API_KEY=sk-or-... ; (рекоменд.) POSTGRES_PASSWORD=<своё>

docker compose up -d --build
docker compose logs -f server     # дождаться «слушаю :8787»; Ctrl+C для выхода из логов
```

Открыть игру: `http://<IPv4-сервера>:8787/`. Откроется онбординг — поле адреса
сервера оставить **пустым** (клиент сам обращается к этому же серверу) →
«Подключиться» → «Новая игра».

Файрвол (если включён ufw): `ufw allow 8787/tcp` — но для приватной игры лучше
не открывать порт наружу, а ходить через Tailscale (ниже).

## Ключи и модели по ролям

Два пути:

1. **Через `.env`** (перезапуск `docker compose up -d` без пересборки):
   - ключи: `OPENROUTER_API_KEY` (общий) + `OPENROUTER_KEY_NARRATOR/_VALIDATOR/_DIRECTOR/_FALLBACK`;
   - модели: `OPENROUTER_MODEL_NARRATOR/_VALIDATOR/_DIRECTOR/_FALLBACK` (так ставится платный
     Ведущий — id см. `docs/reference_paid_narrator_models.md`).
2. **Через админ-панель в браузере** (без доступа к серверу): задайте `ADMIN_PASSWORD` в `.env`,
   затем ⚙ Настройки → «Администрирование» → пароль → правка ключей/моделей. Изменения
   сохраняются в БД и применяются сразу (env — база, админка — поверх). Секреты остаются
   на сервере (в браузер не возвращаются). Без TLS пароль идёт открытым — для публичного
   доступа используйте Caddy+TLS или Tailscale.

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
