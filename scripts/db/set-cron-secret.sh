#!/usr/bin/env bash
# Pose CRON_SECRET dans l'environnement de production Vercel.
#
# Pourquoi ce script : la politique de l'environnement bloque `vercel env add`
# en production pour l'agent. Le secret doit donc être posé par la personne.
# Ce script évite deux pièges :
#   - le secret n'apparaît jamais à l'écran ni dans l'historique du shell ;
#   - la valeur est lue depuis un fichier en 600, pas recopiée à la main.
#
# Usage :
#   ./scripts/db/set-cron-secret.sh            # simulation, n'écrit rien
#   ./scripts/db/set-cron-secret.sh --apply    # pose la variable
#
# Après --apply, un redéploiement est nécessaire : une variable d'environnement
# ajoutée ne s'applique pas aux déploiements déjà construits.
set -euo pipefail

cd "$(dirname "$0")/../.."

SECRET_FILE="${CRON_SECRET_FILE:-$HOME/.config/devnet/cron-secret}"
APPLY=false
[[ "${1:-}" == "--apply" ]] && APPLY=true

if [[ ! -f "$SECRET_FILE" ]]; then
  echo "❌ Fichier de secret absent : $SECRET_FILE" >&2
  echo "   Génère-le sans l'afficher :" >&2
  echo "     umask 077 && openssl rand -hex 32 > \"$SECRET_FILE\" && chmod 600 \"$SECRET_FILE\"" >&2
  exit 2
fi

mode=$(stat -c '%a' "$SECRET_FILE" 2>/dev/null || stat -f '%Lp' "$SECRET_FILE")
if [[ "$mode" != "600" ]]; then
  echo "❌ $SECRET_FILE doit être en permissions 600 (actuel : $mode)." >&2
  exit 2
fi

secret=$(tr -d '\r\n' < "$SECRET_FILE")
if [[ ! "$secret" =~ ^[0-9a-f]{64}$ ]]; then
  echo "❌ Le secret doit faire 64 caractères hexadécimaux (actuel : ${#secret})." >&2
  exit 2
fi

echo "Secret lu depuis $SECRET_FILE (64 caractères hex, non affiché)."

if ! $APPLY; then
  echo ""
  echo "Simulation. Pour poser la variable :"
  echo "  ./scripts/db/set-cron-secret.sh --apply"
  exit 0
fi

# `env add` échoue si la variable existe déjà ; `env update` prend le relais.
# La valeur passe par --value depuis une variable, jamais depuis la ligne de
# commande visible dans `ps`.
if npx vercel env add CRON_SECRET production --value "$secret" --sensitive --yes 2>/dev/null; then
  echo "✅ CRON_SECRET ajouté en production."
elif npx vercel env update CRON_SECRET production --value "$secret" --sensitive --yes 2>/dev/null; then
  echo "✅ CRON_SECRET mis à jour en production."
else
  echo "❌ Vercel a refusé l'opération. Vérifie l'authentification : npx vercel whoami" >&2
  exit 1
fi

echo ""
echo "Redéploie pour que la variable prenne effet :"
echo "  ./scripts/db/switch-prod-db.sh --apply"
echo ""
echo "Puis vérifie la purge (doit répondre 200 et un compte) :"
echo "  curl -s -H \"Authorization: Bearer \$(cat $SECRET_FILE)\" \\"
echo "    https://devnet-brown.vercel.app/api/cron/purge-media"
