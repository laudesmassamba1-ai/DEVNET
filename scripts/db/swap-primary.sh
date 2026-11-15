#!/usr/bin/env bash
#
# Inverse la primaire et la secours de la production.
#
#   ./scripts/db/swap-primary.sh              # simulation : montre le plan
#   ./scripts/db/swap-primary.sh --apply      # inverse, redéploie, vérifie
#
# Pourquoi ce script existe : le 14 novembre, Systalink (primaire) est tombée
# et l'application a basculé sur Neon (secours). Elle y vit depuis. C'est un
# état qui fonctionne, mais ce n'est pas un état normal : le jour où Neon
# bronche, il n'y a plus rien derrière. Et la secours est déclarée comme une
# secours, donc les outils la traitent comme telle — la sauvegarde vise la
# base « active », la synchronisation de schéma vise la « secours ».
#
# Ce script remet les rôles dans le bon sens : la base vivante devient la
# primaire, la base morte devient la secours.
#
# Garde-fous :
#   - refuse si la nouvelle primaire n'est pas joignable ;
#   - refuse si son schéma n'est pas à niveau (migrations en attente) ;
#   - refuse si les deux URL sont identiques ;
#   - simulation par défaut ;
#   - n'affiche jamais une URL de connexion, seulement hôte masqué et base.
#
# Ce qu'il ne fait pas : il ne copie aucune donnée. Il échange deux variables
# d'environnement et redéploie.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

PROD_URL="https://devnet-brown.vercel.app"
ENV_FILE=".env.local"

# ── Lecture des deux URL, sans jamais les afficher ──────────────────────
read_env() {
  local name="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  grep -m1 "^${name}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' | xargs || true
}

CURRENT_PRIMARY="$(read_env DATABASE_URL)"
CURRENT_STANDBY="$(read_env DATABASE_URL_STANDBY)"
CURRENT_PRIMARY_UNPOOLED="$(read_env DATABASE_URL_UNPOOLED)"
CURRENT_STANDBY_UNPOOLED="$(read_env DATABASE_URL_STANDBY_UNPOOLED)"

if [[ -z "$CURRENT_PRIMARY" || -z "$CURRENT_STANDBY" ]]; then
  echo "ÉCHEC : il faut DATABASE_URL et DATABASE_URL_STANDBY dans $ENV_FILE." >&2
  exit 1
fi

if [[ "$CURRENT_PRIMARY" == "$CURRENT_STANDBY" ]]; then
  echo "ÉCHEC : primaire et secours sont identiques, il n'y a rien à inverser." >&2
  exit 1
fi

mask() {
  node -e '
    const h = new URL(process.argv[1]).hostname;
    const p = new URL(process.argv[1]).pathname.replace(/^\//, "");
    console.log((h.length > 12 ? `${h.slice(0, 6)}***${h.slice(-6)}` : "***") + " / " + p);
  ' "$1"
}

echo "Inversion primaire <-> secours"
echo "  primaire actuelle : $(mask "$CURRENT_PRIMARY")"
echo "  secours actuelle  : $(mask "$CURRENT_STANDBY")"
echo "  mode              : $([[ "$APPLY" -eq 1 ]] && echo application || echo simulation)"
echo ""

# ── Garde-fou 1 : la nouvelle primaire doit être joignable ──────────────
echo "1/4  joignabilité de la nouvelle primaire"
if ! node -e '
  const { Client } = require("pg");
  const url = process.argv[1];
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  c.connect()
    .then(() => c.query("select 1"))
    .then(() => { console.log("ok"); return c.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
' "$CURRENT_STANDBY" >/dev/null 2>&1; then
  echo "ÉCHEC : la nouvelle primaire ne répond pas. Rien n'a été modifié." >&2
  exit 1
fi
echo "     ✓ joignable"

# ── Garde-fou 2 : son schéma doit être à niveau ─────────────────────────
# Une primaire en retard accepterait des écritures en perdant des colonnes.
# C'est exactement ce que la bascule refuse de faire dans l'autre sens.
echo "2/4  schéma de la nouvelle primaire"
DB_TARGET=remote npx tsx scripts/db/migrate.ts --database-url="$CURRENT_STANDBY" >/tmp/swap-schema.log 2>&1 || true
if grep -q 'migration(s) à appliquer' /tmp/swap-schema.log; then
  echo "ÉCHEC : des migrations sont en attente sur la nouvelle primaire." >&2
  echo "        La promouvoir ferait perdre des colonnes." >&2
  grep -E '^\s+[0-9]{3}_' /tmp/swap-schema.log | head -5 >&2 || true
  rm -f /tmp/swap-schema.log
  exit 1
fi
rm -f /tmp/swap-schema.log
echo "     ✓ à niveau"

# ── Garde-fou 3 : la nouvelle secours peut rester morte ─────────────────
# Ce n'est pas bloquant : c'est précisément son état actuel. On le dit.
echo "3/4  état de la future secours"
if node -e '
  const { Client } = require("pg");
  const c = new Client({ connectionString: process.argv[1], connectionTimeoutMillis: 6000 });
  c.connect().then(() => c.query("select 1")).then(() => c.end())
    .catch(() => process.exit(1));
' "$CURRENT_PRIMARY" >/dev/null 2>&1; then
  echo "     ✓ joignable (elle restera armée comme secours)"
else
  echo "     ⚠ injoignable — elle sera armée quand même : c'est le filet,"
  echo "       et un filet troué vaut mieux que pas de filet. /api/ready le dira."
fi

if [[ "$APPLY" -eq 0 ]]; then
  cat <<PLAN

4/4  avec --apply, le script ferait :
       vercel env update DATABASE_URL           production  <- $(mask "$CURRENT_STANDBY")
       vercel env update DATABASE_URL_UNPOOLED  production  <- (URL directe)
       vercel env update DATABASE_URL_STANDBY   production  <- $(mask "$CURRENT_PRIMARY")
       vercel env update DATABASE_FAILOVER      production  <- auto
       puis vercel --prod, puis vérification de /api/ready

Simulation. Rien n'a été modifié. Ajouter --apply pour inverser.
PLAN
  exit 0
fi

# ── Application ────────────────────────────────────────────────────────
echo "4/4  inversion des variables de production"

# L'URL directe (sans pooler) sert aux migrations et aux dumps. Si elle
# n'était pas définie, on retombe sur l'URL avec pooler : moins bon pour
# `pg_dump`, mais jamais faux.
NEW_PRIMARY_UNPOOLED="${CURRENT_STANDBY_UNPOOLED:-$CURRENT_STANDBY}"
NEW_STANDBY_UNPOOLED="${CURRENT_PRIMARY_UNPOOLED:-$CURRENT_PRIMARY}"

set_env() {
  local name="$1" value="$2"
  npx vercel env update "$name" production --value "$value" --sensitive --yes >/dev/null 2>&1 \
    || npx vercel env add "$name" production --value "$value" --sensitive --yes >/dev/null 2>&1 \
    || { echo "ÉCHEC : impossible de poser $name" >&2; exit 1; }
  echo "     ✓ $name"
}

set_env DATABASE_URL "$CURRENT_STANDBY"
set_env DATABASE_URL_UNPOOLED "$NEW_PRIMARY_UNPOOLED"
set_env DATABASE_URL_STANDBY "$CURRENT_PRIMARY"
set_env DATABASE_URL_STANDBY_UNPOOLED "$NEW_STANDBY_UNPOOLED"
set_env DATABASE_FAILOVER "auto"

# La machine locale doit voir la même chose : c'est elle qui sauvegarde la
# base active et qui entretient le schéma de la secours chaque nuit.
if [[ -f "$ENV_FILE" ]]; then
  cp "$ENV_FILE" "$ENV_FILE.bak-swap-$(date +%Y%m%d-%H%M%S)"
  node -e '
    const fs = require("fs");
    const [file, primary, primaryUnpooled, standby, standbyUnpooled] = process.argv.slice(1);
    let text = fs.readFileSync(file, "utf8");
    const set = (name, value) => {
      const line = `${name}=\x27${value}\x27`;
      const re = new RegExp(`^${name}=.*$`, "m");
      text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "")}\n${line}\n`;
    };
    set("DATABASE_URL", primary);
    set("DATABASE_URL_UNPOOLED", primaryUnpooled);
    set("DATABASE_URL_STANDBY", standby);
    set("DATABASE_URL_STANDBY_UNPOOLED", standbyUnpooled);
    set("DATABASE_FAILOVER", "auto");
    fs.writeFileSync(file, text, { mode: 0o600 });
  ' "$ENV_FILE" "$CURRENT_STANDBY" "$NEW_PRIMARY_UNPOOLED" "$CURRENT_PRIMARY" "$NEW_STANDBY_UNPOOLED"
  echo "     ✓ $ENV_FILE mis à jour (sauvegarde conservée, valeurs non affichées)"
fi

echo ""
echo "5/5  redéploiement"
npx vercel --prod --yes 2>&1 | tail -3

echo ""
echo "6/6  vérification"
sleep 8
echo -n "  /api/ready : "
curl -s -m 30 "$PROD_URL/api/ready" || true
echo ""
echo ""
echo "Attendu : \"active\":\"primary\" (la base vivante est désormais la primaire)."
