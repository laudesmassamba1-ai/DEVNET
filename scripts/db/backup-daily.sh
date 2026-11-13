#!/usr/bin/env bash
# Sauvegarde quotidienne de la base active (Neon).
#
# Pourquoi un script et pas une ligne `npm run` : la sauvegarde doit passer
# par l'URL **directe** (`DATABASE_URL_UNPOOLED`). Le pooler multiplexe les
# connexions, et `pg_dump` a besoin d'une session stable — un dump à travers
# le pooler peut échouer ou produire une archive incohérente.
#
# Les valeurs ne sont jamais écrites ici : elles sont lues dans `.env.local`,
# qui reste hors de Git.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Charge `.env.local` sans l'exporter dans la sortie du script.
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

if [ -z "${DATABASE_URL_UNPOOLED:-}" ]; then
  echo "❌ DATABASE_URL_UNPOOLED absent de .env.local : sauvegarde annulée." >&2
  exit 2
fi

# `--upload` dépose l’archive **déjà chiffrée** hors site (R2, préfixe db-backups/).
# Sans jeton, la copie est ignorée sans faire échouer la sauvegarde locale.
export DB_TARGET=remote
exec npx tsx scripts/db/backup.ts --database-url="$DATABASE_URL_UNPOOLED" --upload "$@"
