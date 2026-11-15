#!/usr/bin/env bash
# Démarre le serveur de développement **détaché**.
#
#   ./scripts/serve.sh          démarre sur le port 3000
#   ./scripts/serve.sh 4000     démarre sur un autre port
#   ./scripts/stop.sh           arrête
#
# Pourquoi un script plutôt que `npm run dev` ?
#
# Dans cet environnement, un processus lancé depuis une commande est tué
# quand cette commande se termine. Un `next dev &` lancé ainsi tient
# quelques minutes, puis disparaît — et le navigateur affiche
# ERR_CONNECTION_REFUSED alors que tout allait bien une seconde
# avant. C'est un échec silencieux : rien dans le journal du serveur ne
# dit qu'il s'est arrêté, seule l'absence de réponse en dit quelque
# chose.
#
# On procède donc par un double fork : le petit-fils est adopté par
# `init`, dans sa propre session, sans terminal. Il survit à la
# fermeture de la commande qui l'a lancé, exactement comme un service.
#
# Vérifier que ça tient, c'est vérifier **depuis une autre commande** :
# un serveur lancé et testé dans la même commande ne prouve rien, il
# était encore vivant au moment du test.

set -euo pipefail

PORT="${1:-3000}"
cd "$(dirname "$0")/.."

if curl -s -o /dev/null --max-time 3 "http://localhost:${PORT}/"; then
  echo "Un serveur écoute déjà sur le port ${PORT}."
  exit 0
fi

LOG="dev-server.log"

# Double fork via Python : `setsid` seul ne suffit pas toujours, parce
# que le processus garde la même liste de descendants que la commande.
python3 - "$PORT" "$LOG" <<'PY'
import os, sys

port, logpath = sys.argv[1], sys.argv[2]

if os.fork() > 0:
    os._exit(0)          # le parent quitte, le fils est orphelin
os.setsid()              # nouvelle session : plus de terminal
if os.fork() > 0:
    os._exit(0)          # petit-fils, adopté par init

# Le répertoire de travail est déjà le bon : le script s'y place avant de
# lancer Python, et `execvp` en hérite.
os.umask(0o022)

devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
out = os.open(logpath, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(out, 1)
os.dup2(out, 2)

os.execvp("node", ["node", "./node_modules/.bin/next", "dev", "-p", port])
PY

# On attend que le port réponde, plutôt que de rendre la main à l'appelant
# sur une promesse : un serveur lancé mais pas encore prêt donne la même
# erreur au navigateur.
for _ in $(seq 1 60); do
  sleep 1
  if curl -s -o /dev/null --max-time 2 "http://localhost:${PORT}/"; then
    echo "Serveur prêt sur http://localhost:${PORT}"
    echo "Journal : ${LOG}"
    exit 0
  fi
done

echo "Le serveur n'a pas répondu à temps. Journal :"
tail -20 "${LOG}"
exit 1