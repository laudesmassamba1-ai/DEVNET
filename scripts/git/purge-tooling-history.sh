#!/usr/bin/env bash
#
# Retire les fichiers d'outillage de tout l'historique local.
#
#   scripts/git/purge-tooling-history.sh            # simulation, ne change rien
#   scripts/git/purge-tooling-history.sh --execute  # réécrit les références locales
#
# Aucun push n'est effectué par ce script, jamais : publier un historique
# réécrit est une décision explicite, prise après avoir lu la sortie.
set -euo pipefail

# Fichiers et dossiers retirés de chaque commit. Les deux derniers ne sont pas
# des documents : ce sont un lien et une archive de 29 Mo poussés par erreur.
TARGETS=(
  .agents
  .claude
  .github/skills
  AGENTS.md
  CLAUDE.md
  MEMO.md
  AUDIT.md
  DESIGN.md
  skills-lock.json
  alphacode
  goose-x86_64-unknown-linux-gnu.tar.bz2
  'kimi-debug-session_*'
)

# Liste citée une fois pour toutes : un nom d'archive ou un dossier de
# session ne doit pas être réinterprété par le shell de git filter-branch.
quoted_targets=""
for target in "${TARGETS[@]}"; do
  quoted_targets+=" $(printf '%q' "$target")"
done

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Ce script doit être lancé depuis le dépôt." >&2
  exit 1
fi

if [[ "${1:-}" != "--execute" ]]; then
  echo "Simulation — occurrences encore présentes dans l'historique :"
  total=0
  for target in "${TARGETS[@]}"; do
    count=$(git log --all --oneline -- "$target" | wc -l | tr -d ' ')
    if [[ "$count" != "0" ]]; then
      echo "  $target : $count commit(s)"
      total=$((total + count))
    fi
  done
  echo
  echo "Objets du dépôt : $(git rev-list --all --count) commits, $(git count-objects -vH | awk '/^size-pack/ {print $2 $3}') pack."
  if [[ "$total" == "0" ]]; then
    echo "Rien à retirer : l'historique est déjà propre."
  else
    echo "Aucune modification. Relancer avec --execute pour réécrire les références locales."
  fi
  exit 0
fi

worktree_dirty=$(git status --porcelain | wc -l | tr -d ' ')
if [[ "$worktree_dirty" != "0" ]]; then
  echo "Refus : l'arbre de travail a $worktree_dirty modification(s). Commiter ou remiser d'abord." >&2
  exit 1
fi

backup="backup/avant-purge-$(date +%Y%m%d-%H%M%S)"
git branch "$backup"
echo "Sauvegarde locale : $backup"

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force --index-filter \
  "git rm -r --cached --ignore-unmatch --${quoted_targets}" \
  --prune-empty -- --all

git for-each-ref --format='%(refname)' refs/original | while read -r ref; do
  git update-ref -d "$ref"
done
git reflog expire --expire=now --all
git gc --prune=now --quiet

echo
echo "Historique local réécrit. À faire ensuite, explicitement :"
echo "  1. vérifier : git log --all --oneline -- ${TARGETS[*]}   (doit être vide)"
echo "  2. publier : git push --force-with-lease origin main refactor/independence"
echo "  3. prévenir : les autres clones ont des SHA qui n'existent plus, il faut les refaire."
