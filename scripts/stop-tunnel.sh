#!/usr/bin/env bash
# Arrête le tunnel Cloudflare détaché (voir `scripts/tunnel.sh`).

set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f tunnel.pid ]; then
  echo "Aucun tunnel ne semble tourner (pas de tunnel.pid)."
  exit 0
fi

PID="$(cat tunnel.pid 2>/dev/null || echo "")"

if [ -z "${PID}" ] || ! kill -0 "${PID}" 2>/dev/null; then
  echo "Le processus du tunnel n'est plus actif."
  rm -f tunnel.pid tunnel-url.txt
  exit 0
fi

# On tue d'abord le processus lui-même, puis cloudflared peut avoir
# laissé des fils (voir connexions WebSocket) : on nettoie par prudence.
kill "${PID}" 2>/dev/null || true
sleep 1

if kill -0 "${PID}" 2>/dev/null; then
  kill -9 "${PID}" 2>/dev/null || true
  sleep 1
fi

rm -f tunnel.pid tunnel-url.txt
echo "Tunnel arrêté."
