#!/usr/bin/env bash
# Restauration dans une base CIBLE (à tester régulièrement sur une base vide, jamais « à l'aveugle » en production).
#   TARGET_URL=postgres://…/roadpulse_restore ./restore.sh backups/roadpulse-XXXX.dump
set -euo pipefail
: "${TARGET_URL:?TARGET_URL requis (base cible)}"; FILE="${1:?fichier .dump requis}"
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$TARGET_URL" "$FILE"
echo "Restauration terminée dans la base cible. Vérifier : SELECT count(*) FROM schema_migrations;"
