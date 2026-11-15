#!/usr/bin/env bash
#
# Active (ou coupe) la bascule automatique de la production vers une base de
# secours.
#
#   ./scripts/db/configure-failover.sh                 # simulation : montre le plan
#   ./scripts/db/configure-failover.sh --apply         # configure et redéploie
#   ./scripts/db/configure-failover.sh --apply --off   # coupe la bascule
#
# Pourquoi un script : la bascule vit dans deux variables d'environnement de
# production (DATABASE_URL_STANDBY, DATABASE_FAILOVER). Les poser à la main,
# c'est risquer de promouvoir une base au schéma ancien — c'est-à-dire de
# remplacer une panne visible par une perte de colonnes silencieuse. Ce script
# vérifie donc le schéma **avant** d'armer quoi que ce soit.
#
# Ce qu'il ne fait pas : il ne copie aucune donnée. Une secours à jour de
# schéma reste une secours vide de tout ce qui a été écrit ailleurs. La
# promotion est visible dans /api/ready (`active: "standby"`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APPLY=0
OFF=0
URL=""
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --off) OFF=1 ;;
    --url=*) URL="${arg#--url=}" ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

PROD_URL="https://devnet-brown.vercel.app"
STANDBY_ENV_FILE=".env.standby"

# L'URL de secours vient de --url, puis de l'environnement, puis du fichier
# dédié. Elle n'est jamais affichée : seuls l'hôte masqué et la base le sont.
if [[ -z "$URL" && -n "${DATABASE_URL_STANDBY:-}" ]]; then
  URL="$DATABASE_URL_STANDBY"
fi
if [[ -z "$URL" && -f "$STANDBY_ENV_FILE" ]]; then
  URL="$(grep -m1 '^DATABASE_URL=' "$STANDBY_ENV_FILE" | cut -d= -f2- | tr -d '"' | xargs || true)"
fi

# ── Coupure ────────────────────────────────────────────────────────────
if [[ "$OFF" -eq 1 ]]; then
  echo "Bascule automatique : à COUPER"
  if [[ "$APPLY" -eq 0 ]]; then
    cat <<'PLAN'

Simulation. Avec --apply, le script ferait :

  1. vercel env update DATABASE_FAILOVER production --value off
  2. vercel --prod
  3. vérification : /api/ready doit répondre "standbyConfigured": false

La base primaire reste la seule utilisée. Rien n'a été modifié.
PLAN
    exit 0
  fi
  npx vercel env update DATABASE_FAILOVER production --value "off" --sensitive --yes
  npx vercel --prod --yes
  sleep 5
  echo -n "  /api/ready : "
  curl -s -m 30 "$PROD_URL/api/ready"
  echo ""
  exit 0
fi

if [[ -z "$URL" ]]; then
  echo "ÉCHEC : aucune URL de secours." >&2
  echo "        Poser $STANDBY_ENV_FILE (DATABASE_URL=…), ou --url=…" >&2
  exit 1
fi

HOST="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$URL")"
NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.replace(/^\//,""))' "$URL")"
MASKED="$(node -e '
const h = new URL(process.argv[1]).hostname;
console.log(h.length > 12 ? `${h.slice(0,6)}***${h.slice(-6)}` : "***");
' "$URL")"

echo "Secours        : $MASKED / $NAME"
echo "Projet Vercel  : devnet (production)"
echo ""

# ── Garde-fou : le schéma de la secours doit être celui du dépôt ───────
# On interroge la secours seule (la primaire peut être morte : c'est même le
# cas d'usage). Toute migration en attente signifie « cette base n'est pas
# prête à servir l'application ».
echo "1/3  schéma de la secours"
# `migrate.ts` en simulation liste les migrations en attente sans rien écrire.
# DB_TARGET=remote : la cible est distante, le garde-fou des scripts l'exige.
PENDING="$(DB_TARGET=remote npx tsx scripts/db/migrate.ts --database-url="$URL" 2>&1 \
  | grep -c 'migration(s) à appliquer' || true)"
if [[ "${PENDING:-0}" -gt 0 ]]; then
  echo "ÉCHEC : $PENDING migration(s) en attente sur la secours." >&2
  echo "        La promouvoir ferait perdre des colonnes." >&2
  echo "        D'abord : npx tsx scripts/db/sync-standby.ts --to=\"\$URL\" --apply" >&2
  exit 1
fi
echo "     ✓ à niveau"

if [[ "$APPLY" -eq 0 ]]; then
  cat <<PLAN

2/3  vercel env update DATABASE_URL_STANDBY production   <- $MASKED / $NAME
3/3  vercel env update DATABASE_FAILOVER    production   <- auto
     puis vercel --prod, puis vérification de /api/ready

Simulation. Rien n'a été modifié. Ajouter --apply pour armer la bascule.
PLAN
  exit 0
fi

echo "2/3  DATABASE_URL_STANDBY"
npx vercel env update DATABASE_URL_STANDBY production --value "$URL" --sensitive --yes 2>/dev/null \
  || npx vercel env add DATABASE_URL_STANDBY production --value "$URL" --sensitive --yes

echo "3/3  DATABASE_FAILOVER=auto"
npx vercel env update DATABASE_FAILOVER production --value "auto" --sensitive --yes 2>/dev/null \
  || npx vercel env add DATABASE_FAILOVER production --value "auto" --sensitive --yes

# La machine locale a besoin des mêmes clés : c'est elle qui entretient le
# schéma de la secours chaque nuit (scripts/db/sync-standby-daily.sh) et qui
# sauvegarde la base active (`backup.ts --active`).
#
# Les valeurs sont **quotées** : une URL Neon porte `?sslmode=require&…`, et un
# `&` non protégé dans un fichier sourcé par `.` lance une commande au lieu de
# définir une variable. C'est arrivé au premier essai.
if [[ -f .env.local ]] && ! grep -q '^DATABASE_URL_STANDBY=' .env.local; then
  {
    echo ""
    echo "# Base de secours (bascule automatique) — URL directe, pour les"
    echo "# migrations et les dumps autant que pour les requêtes."
    echo "DATABASE_URL_STANDBY='$URL'"
    echo "DATABASE_URL_STANDBY_UNPOOLED='$URL'"
    echo "DATABASE_FAILOVER=auto"
  } >> .env.local
  echo "     ✓ .env.local : clés de secours ajoutées (valeurs non affichées)"
fi

echo "4/4  redéploiement"
npx vercel --prod --yes

echo "5/5  vérification"
sleep 5
echo -n "  /api/ready : "
curl -s -m 30 "$PROD_URL/api/ready" || true
echo ""
