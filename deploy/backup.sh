#!/usr/bin/env sh
# Бэкап БД (ТЗ §15): pg_dump кампаний/снапшотов/векторов/конфига → сжатый дамп с ротацией.
# Postgres — единственный источник истины: без бэкапа сбой диска = потеря всего прогресса.
#
# Запуск вручную:   sh deploy/backup.sh
# По расписанию (cron на хосте, ежедневно в 04:30):
#   30 4 * * *  cd /path/to/dnd && sh deploy/backup.sh >> /var/log/dnd-backup.log 2>&1
#
# Переменные (необязательно):
#   BACKUP_DIR  — куда складывать (по умолчанию ./backups)
#   KEEP        — сколько последних дампов держать (по умолчанию 14)
#   DB_SERVICE  — имя сервиса БД в compose (по умолчанию db)
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${KEEP:-14}"
DB_SERVICE="${DB_SERVICE:-db}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/rpg-${STAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

# Дамп изнутри контейнера БД (creds совпадают с docker-compose.yml: пользователь/БД = rpg).
docker compose exec -T "$DB_SERVICE" pg_dump -U rpg -d rpg | gzip > "$OUT"

echo "[backup] создан $OUT ($(du -h "$OUT" | cut -f1))"

# Ротация: оставить только последние $KEEP дампов.
ls -1t "${BACKUP_DIR}"/rpg-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
	rm -f "$old"
	echo "[backup] удалён старый $old"
done

# Восстановление (вручную, при необходимости):
#   gunzip -c backups/rpg-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T db psql -U rpg -d rpg
