# Où le code s'exécute réellement (audit §7.1)

Audit du 10 novembre 2026. Lecture de `lib/execution/`, des composants qui
l'appellent et de `next.config.ts`. Conclusion d'abord, détails ensuite.

## Verdict

**Le code de l'utilisateur ne s'exécute pas dans le processus de
l'application, ni avec accès à la base ou aux secrets.** Il s'exécute dans
un **Web Worker du navigateur**, créé par le fil principal, et terminé
(`worker.terminate()`) au-delà de 10 s. CR-01 est donc tenu sur le point
« processus de l'application ».

**En revanche, CR-02 n'est pas tenu** : le worker a l'**origine de
l'application** (il n'est pas dans une iframe à origine opaque), il peut
appeler `fetch` avec les cookies de session, et il charge des mégaoctets
depuis deux CDN tiers. C'est une faille à corriger, pas un détail.

## Ce qui existe

| Élément | Réalité |
|---|---|
| Moteur d'exécution | `lib/execution/engine.ts` (noyau JS autonome), collé dans le worker par `worker-source.ts` |
| Hébergement | `Worker` créé dans le fil principal (`lib/execution/runner.ts`) |
| Langages | Python (Pyodide), JavaScript/TypeScript (noyau maison + compilation TS), C/C++/Ruby/PHP/SQL (WASI via Runno) |
| Téléchargement | Pyodide : `cdn.jsdelivr.net/pyodide@0.26.4` ; WASI : `cdn.jsdelivr.net/npm/@runno/wasi@0.10.0` + binaires `runno.dev/langs/` |
| Limites | délai d'exécution **10 s** (`LIMITS.timeoutMs`), démarrage **60 s**, sortie plafonnée à **200 000 caractères** (`LIMITS.maxOutput`), troncature annoncée |
| Arrêt | `worker.terminate()` à l'échéance ou à l'`abort` de l'utilisateur |
| Entrée standard | passée au worker (`stdin`), pas de réseau requis |
| Rendu de sortie | texte, via `appendOutput` — jamais du HTML |
| Bouton « Exécuter » | clic explicite dans l'éditeur et les cartes exécutables ; rien ne part au défilement |
| Tests | `test:execution` (~145 vérifications) sur le noyau, les limites et la compilation TS |

## Écarts au contrat, par gravité

1. **CR-02 (BLOQUANT) — réseau et cookies accessibles.**
   Un worker hérite de l'origine de la page : `fetch("/api/…")` part avec les
   cookies de session. Un snippet hostile peut donc agir **en tant que
   l'utilisateur** sur l'application (publier, supprimer, changer des
   réglages) sans jamais toucher au serveur d'exécution. Aucune CSP
   `connect-src 'none'` n'est posée (vérifié dans `next.config.ts` : pas de
   `Content-Security-Policy`).
2. **CR-02/PF-03 — dépendances CDN au premier « Exécuter ».**
   Pyodide et Runno sont chargés depuis jsdelivr, les binaires depuis
   runno.dev : disponibilité, latence et **fuite d'IP** vers deux tiers. Le
   poids (plusieurs Mo) n'est pas annoncé avec une taille mesurée.
3. **CR-03 (BLOQUANT, partiel) — délai et sortie oui, mémoire non.**
   Aucun plafond mémoire mesurable ; une bombe mémoire ne tue pas le worker
   avant le délai (10 s de gel possible de l'onglet).
4. **CR-06 (BLOQUANT) — pas de quota ni d'interrupteur admin.**
   La limitation est côté client uniquement : un script peut appeler
   l'exécuteur en boucle. Aucun interrupteur global d'administration.
5. **CR-07 — preuve d'exécution.** Le résultat est déclaratif (calculé côté
   client) : il doit rester étiqueté comme tel ; rien ne le présente comme
   une validation serveur aujourd'hui, mais aucun libellé ne le dit non plus.
6. **MO-03/MO-04** : le mouvement réduit est respecté, les niveaux N0–N3 ne
   sont pas surchargeables (voir `docs/ui/motion.md`, dette).

## Correctif proposé (architecture du contrat)

1. **Iframe à origine opaque** : héberger l'éditeur d'exécution dans
   `<iframe sandbox="allow-scripts">` (sans `allow-same-origin`), avec
   `<meta http-equiv="Content-Security-Policy" content="default-src 'none';
   script-src 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net;
   connect-src 'none'">`. Le worker créé **dans** cette iframe hérite de
   l'origine opaque : les requêtes vers l'application deviennent
   cross-origin, sans cookies. `postMessage` transporte code et sortie.
2. **Bloquer les globals dangereux** avant d'évaluer le code : `fetch`,
   `XMLHttpRequest`, `WebSocket`, `EventSource`, `importScripts`,
   `navigator.sendBeacon`, `indexedDB`, `caches`, `localStorage`.
3. **Plafond mémoire** : surveiller la taille de la sortie et la durée ; à
   défaut de mémoire mesurable, borner aussi le nombre de lignes et tuer le
   worker plus tôt (par exemple 5 s) pour les langages lents.
4. **Quota + interrupteur** : compteur par utilisateur (client, à défaut de
   serveur) et réglage `codeRunnerEnabled` côté administration, lu par
   l'interface ; l'exécuteur n'est même pas monté quand il est coupé.
5. **Annoncer le poids** : mesurer les octets réels de Pyodide/Runno et
   n'afficher le bouton qu'après accord en économie de données.

**Décision requise de Laudes** avant de toucher au moteur : le correctif
(iframe opaque + blocage réseau) change l'hébergement, pas l'API publique de
`runCode`. Il peut casser des parcours existants si un exercice a besoin du
réseau (aucun cas recensé aujourd'hui).
