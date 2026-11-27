#!/usr/bin/env bash
# Sauvegarde logique de PostgreSQL (format personnalisé, compressé). Usage :
#   DATABASE_URL=postgres://… BACKUP_DIR=/var/backups/roadpulse KEEP_DAYS=14 ./backup.sh
# À planifier (cron) ; copier ensuite les fichiers HORS du serveur et chiffrer (ex. age, gpg) : ils contiennent des données.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL requis}"
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP_DAYS:-14}"
mkdir -p "$DIR"; umask 077
FILE="$DIR/roadpulse-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE"
pg_restore --list "$FILE" > /dev/null          # vérifie que l'archive est lisible
find "$DIR" -name 'roadpulse-*.dump' -mtime +"$KEEP" -delete
echo "Sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1))"
