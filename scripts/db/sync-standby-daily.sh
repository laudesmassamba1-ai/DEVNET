#!/usr/bin/env bash
# Remise à niveau quotidienne de la base de secours.
#
# Pourquoi : la bascule automatique refuse de promouvoir une secours dont le
# schéma diffère de celui de la primaire. Sans entretien, la secours prend du
# retard à chaque migration et devient inutilisable le jour où on en a besoin —
# c'est-à-dire trop tard. Ce script applique les migrations manquantes, une par
# transaction, et ne copie **aucune donnée**.
#
# Ordre des références :
#   1. la primaire, si elle répond — c'est l'état réel de la production ;
#   2. le dépôt, si la primaire est injoignable — une secours doit au moins
#      connaître le schéma que le code attend (cas du 14 novembre : la
#      primaire refusait toute connexion, la secours devait rester utilisable).
#
# Sortie silencieuse quand tout va bien : une minuterie ne doit alerter que
# lorsqu'elle a quelque chose à dire.
#
# ── Correction du 14 novembre ──────────────────────────────────────────
# Ce script sortait en 0 même quand la secours refusait toute connexion :
# `exec` lançait la migration, elle échouait, et le système d'init ne voyait
# qu'un succès. Une minuterie qui échoue en silence est pire qu'une minuterie
# absente, parce qu'elle fait croire que la secours est entretenue.
#
# Il distingue maintenant trois issues :
#   0  secours à niveau, ou aucune secours configurée ;
#   0  secours injoignable **et** primaire saine — ce n'est pas une panne de
#      la production, seulement une secours indisponible : on le dit, sans
#      marquer la minuterie en échec ;
#   1  secours joignable mais en retard, ou primaire morte **et** secours
#      injoignable — là, quelqu'un doit regarder.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Les variables déjà présentes dans l'environnement gagnent sur le fichier.
# Sans cela, un test qui pose DATABASE_URL pour simuler une base morte se
# ferait écraser par `.env.local` — et le test passerait en mesurant la vraie
# base. C'est exactement ce qui est arrivé au premier essai de ce script.
ENV_PRIMARY="${DATABASE_URL:-}"
ENV_STANDBY="${DATABASE_URL_STANDBY:-}"
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a
# `if` explicite et non `[ -n ] && VAR=…` : sous `set -e`, un test faux en fin
# de ligne fait sortir le script. C'est ce qui rendait la restauration
# inopérante quand une des deux variables n'était pas posée.
if [ -n "$ENV_PRIMARY" ]; then DATABASE_URL="$ENV_PRIMARY"; fi
if [ -n "$ENV_STANDBY" ]; then DATABASE_URL_STANDBY="$ENV_STANDBY"; fi
set +a

if [ -z "${DATABASE_URL_STANDBY:-}" ]; then
  echo "⏭  DATABASE_URL_STANDBY absent : aucune secours à entretenir."
  exit 0
fi

# La secours répond-elle ? On le demande avant tout, parce que tout le reste
# en dépend et qu'un échec de connexion n'est pas un échec de synchronisation.
# `scripts/db/reachability.ts` réutilise le transport de l'application (SSL
# auto-signé inclus). Un `new Client({ connectionString })` brut échouait sur
# le certificat Systalink et faisait conclure « injoignable » à tort.
probe() {
  npx tsx scripts/db/reachability.ts "$1" 2>&1 >/dev/null || true
}

standby_reachable() {
  [ -z "$(probe "$DATABASE_URL_STANDBY")" ]
}

primary_reachable() {
  [ -z "$(probe "$DATABASE_URL")" ]
}

STANDBY_DB="$(node -e 'console.log(new URL(process.argv[1]).pathname.replace(/^\//, ""))' "$DATABASE_URL_STANDBY" 2>/dev/null || echo "?")"

if ! standby_reachable; then
  STANDBY_REASON="$(probe "$DATABASE_URL_STANDBY")"
  STANDBY_REASON="${STANDBY_REASON:-connexion impossible}"
  if primary_reachable; then
    echo "⚠️  secours injoignable (base $STANDBY_DB : $STANDBY_REASON) — la production n'est pas affectée."
    echo "    La bascule automatique refusera de la promouvoir tant qu'elle ne répond pas."
    exit 0
  fi
  PRIMARY_REASON="$(probe "$DATABASE_URL")"
  echo "❌ secours injoignable (base $STANDBY_DB : $STANDBY_REASON) ET primaire injoignable (${PRIMARY_REASON:-connexion impossible}) : aucune base saine." >&2
  exit 1
fi

if npx tsx scripts/db/sync-standby.ts --check >/dev/null 2>&1; then
  echo "✓ secours à niveau (référence : la primaire)."
  exit 0
fi

if npx tsx scripts/db/sync-standby.ts --apply; then
  exit 0
fi

# La synchronisation a échoué alors que la secours répond : la primaire est
# probablement la référence manquante. On retombe sur le dépôt.
if primary_reachable; then
  echo "❌ secours joignable mais synchronisation impossible (référence : la primaire)." >&2
  exit 1
fi

echo "⚠️  primaire injoignable : référence = dépôt (base $STANDBY_DB)."
if env DB_TARGET=remote CONFIRM_REMOTE="$STANDBY_DB" \
  npx tsx scripts/db/migrate.ts --database-url="$DATABASE_URL_STANDBY" --apply; then
  exit 0
fi

echo "❌ mise à niveau depuis le dépôt impossible." >&2
exit 1
