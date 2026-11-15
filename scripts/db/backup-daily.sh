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

if [ -z "${DATABASE_URL_UNPOOLED:-}" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ni DATABASE_URL_UNPOOLED ni DATABASE_URL dans .env.local : sauvegarde annulée." >&2
  exit 2
fi

# `--active` : la sauvegarde vise la base qui répond, primaire ou secours.
# Sans cela, la minuterie échouerait pendant toute bascule — précisément
# quand une sauvegarde compte le plus (incident du 14 novembre).
# Pour qu'elle connaisse la secours, `.env.local` doit porter
# DATABASE_URL_STANDBY_UNPOOLED (URL **directe**, jamais le pooler).
export DB_TARGET=remote
exec npx tsx scripts/db/backup.ts --active --upload "$@"
