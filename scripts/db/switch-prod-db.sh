#!/usr/bin/env bash
#
# Bascule la production Vercel de Neon vers la base Systalink.
#
#   ./scripts/db/switch-prod-db.sh            # simulation : montre ce qui serait fait
#   ./scripts/db/switch-prod-db.sh --apply    # applique, redéploie, vérifie
#
# Pourquoi ce script existe : la mutation des variables d'environnement de
# production n'est pas déléguée à l'agent (garde-fou de l'environnement). Elle
# se fait donc ici, en une commande lisible, avec vérification après coup.
#
# Ce qu'il ne fait pas : il ne touche à aucune donnée, ne supprime rien, et
# n'écrit jamais l'URL de connexion dans la sortie.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

SOURCE_FILE=".env.remote"
PROD_URL="https://devnet-brown.vercel.app"

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "ÉCHEC : $SOURCE_FILE est absent (il porte l'URL Systalink)." >&2
  exit 1
fi

# L'URL n'est jamais affichée : on n'en montre que l'hôte et la base.
DB_URL="$(grep -m1 '^DATABASE_URL=' "$SOURCE_FILE" | cut -d= -f2- | tr -d '"' | xargs)"
if [[ -z "$DB_URL" ]]; then
  echo "ÉCHEC : DATABASE_URL introuvable dans $SOURCE_FILE." >&2
  exit 1
fi

DB_HOST="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$DB_URL")"
DB_NAME="$(node -e 'console.log(new URL(process.argv[1]).pathname.replace(/^\//,""))' "$DB_URL")"

echo "Cible          : $DB_HOST / $DB_NAME"
echo "Projet Vercel  : devnet (production)"
echo "URL publique   : $PROD_URL"
echo ""

# Preuve « avant » : les stickers de Neon datent du 2026-11-13 09:23.
before="$(curl -s -m 20 "$PROD_URL/api/stickers" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);console.log(j.stickers?.[0]?.createdAt ?? "n/a");}catch{console.log("n/a");}
});')"
echo "Avant  : stickers servis par la prod = $before"

if [[ "$APPLY" -eq 0 ]]; then
  cat <<'PLAN'

Simulation. Avec --apply, le script ferait :

  1. vercel env update DATABASE_URL production          <- URL Systalink
  2. vercel env update DATABASE_URL_UNPOOLED production <- même URL
  3. vercel env add    PG_POOL_MAX production           <- 3 (pool borné)
  4. vercel --prod                                      <- redéploiement
  5. vérification : stickers, /api/ready, /api/backend-check

Rien n'a été modifié.
PLAN
  exit 0
fi

echo ""
echo "1/5  DATABASE_URL"
npx vercel env update DATABASE_URL production --value "$DB_URL" --sensitive --yes

echo "2/5  DATABASE_URL_UNPOOLED"
npx vercel env update DATABASE_URL_UNPOOLED production --value "$DB_URL" --sensitive --yes

echo "3/5  PG_POOL_MAX=3"
# max_connections = 100 sur Systalink ; à 10 par instance, onze instances
# concurrentes suffiraient à saturer la base. Trois laisse de la marge.
npx vercel env update PG_POOL_MAX production --value "3" --sensitive --yes 2>/dev/null \
  || npx vercel env add PG_POOL_MAX production --value "3" --sensitive --yes

echo "4/5  redéploiement"
npx vercel --prod --yes

echo "5/5  vérification"
sleep 5
echo -n "  /api/ready          : "
curl -s -m 30 "$PROD_URL/api/ready" || true
echo ""
echo -n "  /api/backend-check  : "
curl -s -m 30 "$PROD_URL/api/backend-check" || true
echo ""

after="$(curl -s -m 20 "$PROD_URL/api/stickers" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  try{const j=JSON.parse(s);console.log(j.stickers?.[0]?.createdAt ?? "n/a");}catch{console.log("n/a");}
});')"
echo "Après  : stickers servis par la prod = $after"

# La date des stickers ne prouve rien : l'import a copié Neon dans Systalink,
# donc les deux bases portent les mêmes lignes. La preuve réelle est la
# connexion applicative vue depuis la base cible.
echo ""
echo "Preuve par les connexions : la prod doit apparaître sur Systalink"
curl -s -m 20 "$PROD_URL/api/ready" -o /dev/null
sleep 2
npx tsx scripts/db/check-prod-connections.ts || true
