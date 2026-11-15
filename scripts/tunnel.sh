#!/usr/bin/env bash
# Ouvre un **tunnel public Cloudflare** vers le serveur de développement.
#
#   ./scripts/tunnel.sh          tunnel vers http://localhost:3000
#   ./scripts/tunnel.sh 3001     tunnel vers un autre port
#   ./scripts/stop-tunnel.sh     arrête le tunnel
#
# Pourquoi Cloudflare plutôt qu'un simple port ouvert ?
#
# Dans cet environnement, le serveur n'est joignable que depuis la
# machine locale (`localhost`). Pour le montrer à quelqu'un — ou le
# tester depuis un téléphone, une autre machine — il faut une adresse
# publique. `cloudflared tunnel --url` en crée une en quelques
# secondes, sans compte ni configuration : Cloudflare relaie le trafic
# vers notre port et nous rend une URL `https://*.trycloudflare.com`.
#
# On procède comme dans `serve.sh` : un double fork, pour que le
# tunnel survive à la fermeture de la commande qui l'a lancé. Sans
# cela, le tunnel meurt en même temps que le script et l'URL publique
# devient invalide immédiatement — un échec silencieux.
#
# L'URL publique est écrite dans `tunnel-url.txt` et affichée à la
# fin. cloudflared la journalise aussi dans `tunnel.log`.

set -euo pipefail

PORT="${1:-3000}"
cd "$(dirname "$0")/.."

if ! command -v cloudflared > /dev/null 2>&1; then
  echo "cloudflared n'est pas installé."
  echo "Installe-le depuis https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if ! curl -s -o /dev/null --max-time 3 "http://localhost:${PORT}/"; then
  echo "Aucun serveur ne répond sur http://localhost:${PORT}."
  echo "Lance d'abord : ./scripts/serve.sh ${PORT}"
  exit 1
fi

# cloudflared préfère IPv6 quand le système en a. Ici, IPv6 est injoignable
# (pas de route vers le monde extérieur), et le tunnel échoue silencieusement
# en tentant une connexion UDP vers [2606:4700::...]. On force IPv4.
if ! curl -s -o /dev/null --max-time 5 -4 "https://api.trycloudflare.com/"; then
  echo "IPv4 vers Cloudflare est injoignable. Le tunnel ne pourra pas démarrer."
  exit 1
fi

# Un tunnel existant ? On réutilise son URL plutôt que d'en ouvrir un
# second : chaque trycloudflare est éphémère, en ouvrir deux donne deux
# adresses différentes et deux processus à arrêter.
if [ -f tunnel-url.txt ] && [ -f tunnel.pid ]; then
  OLD_PID="$(cat tunnel.pid 2>/dev/null || echo "")"
  OLD_URL="$(cat tunnel-url.txt 2>/dev/null || echo "")"
  if [ -n "${OLD_PID}" ] && kill -0 "${OLD_PID}" 2>/dev/null && [ -n "${OLD_URL}" ]; then
    echo "Un tunnel tourne déjà (pid ${OLD_PID})."
    echo "URL publique : ${OLD_URL}"
    exit 0
  fi
fi

LOG="tunnel.log"
URL_FILE="tunnel-url.txt"
PID_FILE="tunnel.pid"

# On repart d'une page blanche : un ancien journal laisserait croire à
# un tunnel encore vivant, et une ancienne URL à un tunnel joignable.
: > "${LOG}"
rm -f "${URL_FILE}"

# Double fork via Python, identique à `serve.sh` : le petit-fils est
# adopté par `init`, sans terminal, et survit à la fermeture du script.
python3 - "$PORT" "$LOG" "$PID_FILE" <<'PY'
import os, sys

port, logpath, pidfile = sys.argv[1], sys.argv[2], sys.argv[3]

if os.fork() > 0:
    os._exit(0)          # le parent quitte, le fils est orphelin
os.setsid()              # nouvelle session : plus de terminal
if os.fork() > 0:
    os._exit(0)          # petit-fils, adopté par init

os.umask(0o022)

# On mémorise le pid du vrai processus (le dernier fork), pour pouvoir
# l'arrêter proprement plus tard depuis `stop-tunnel.sh`.
with open(pidfile, "w", encoding="utf-8") as handle:
    handle.write(str(os.getpid()))

devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
out = os.open(logpath, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(out, 1)
os.dup2(out, 2)

os.execvp(
    "cloudflared",
    ["cloudflared", "tunnel", "--url", f"http://localhost:{port}",
     "--edge-ip-version", "4"],
)
PY

# On attend que cloudflared publie l'URL dans le journal, plutôt que de
# rendre la main sur une promesse : un tunnel pas encore établi renvoie
# une erreur au navigateur.
for _ in $(seq 1 45); do
  sleep 1
  URL="$(grep -oE 'https://[a-z0-9-]+-[a-z0-9-]*\.trycloudflare\.com' "${LOG}" 2>/dev/null | head -1 || true)"
  if [ -n "${URL}" ]; then
    printf '%s\n' "${URL}" > "${URL_FILE}"
    echo "Tunnel public prêt."
    echo "URL publique : ${URL}"
    echo "Journal : ${LOG}"
    exit 0
  fi
done

echo "Le tunnel n'a pas publié d'URL à temps. Journal :"
tail -30 "${LOG}"
exit 1
