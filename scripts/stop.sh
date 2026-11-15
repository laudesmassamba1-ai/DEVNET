#!/usr/bin/env bash
# Arrête le serveur de développement détaché (voir `scripts/serve.sh`).

set -uo pipefail
cd "$(dirname "$0")/.."

if ! pgrep -f "next dev -p" > /dev/null; then
  echo "Aucun serveur de développement ne tourne."
  exit 0
fi

pkill -f "next dev -p"
sleep 1

if pgrep -f "next dev -p" > /dev/null; then
  pkill -9 -f "next dev -p"
  sleep 1
fi

echo "Serveur arrêté."