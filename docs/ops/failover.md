# Bascule automatique et base de secours

> Statut au **2026-11-15** : la production et la secours sont sur **Neon**.
> `DATABASE_URL` vise la primaire et `DATABASE_URL_STANDBY` le pooler de la
> même base ; ce n'est donc pas une copie indépendante. Systalink reste
> injoignable. Le mécanisme est éprouvé sur deux vraies bases (13 cas,
> `scripts/test-failover.ts`), dont l'arrêt réel d'un conteneur et une base qui
> accepte le TCP puis ne répond plus jamais.

## 1. Le problème qu'elle résout

Le 14 novembre, la base Systalink a refusé toute connexion :

```
FATAL: server login has been failing, cached error: connect failed (server_login_retry)  (08P01)
```

Le port répondait, le DNS résolvait, `psql` échouait comme l'application. Le code
était sain et déployé ; il n'y avait simplement plus de données. Aucun mécanisme
ne permettait de servir l'application depuis ailleurs sans éditer des variables
d'environnement et redéployer — c'est-à-dire sans être devant un clavier.

## 2. Ce qui existe maintenant

| Pièce | Rôle | Fichier |
|---|---|---|
| Bascule | pool actif, sondes, promotion, retour | `platform/infrastructure/postgres/failover.ts` |
| Pool | point d'entrée unique des adaptateurs | `platform/infrastructure/postgres/pool.ts` |
| Visibilité | `active`, `switchedAt`, `reason`, `schemaMatches` | `app/api/ready/route.ts` |
| Entretien du schéma | applique les migrations manquantes sur la secours | `scripts/db/sync-standby.ts` |
| Armement | pose les variables Vercel, vérifie le schéma d'abord | `scripts/db/configure-failover.sh` |
| Test | 13 cas, dont l'arrêt réel d'un conteneur | `scripts/test-failover.ts` |

## 3. Les trois règles

1. **On ne bascule pas sur une base au schéma différent.** `promote()` compare
   l'empreinte des colonnes de `public` (tables, types, nullabilité) entre
   l'active et la secours. Différence = refus, avec la raison écrite.
   Pourquoi une empreinte et pas un compteur de migrations : le 14 novembre la
   production portait 73 lignes de registre pour 72 fichiers (une migration
   orpheline). Un comptage refusait alors une bascule parfaitement sûre.
2. **La bascule est visible.** `/api/ready` répond `"active":"standby"`. Une
   bascule silencieuse ferait lire des données figées en laissant croire que
   tout va bien.
3. **On revient — sur décision.** Dès que la primaire répond, la sonde de
   l'endpoint inactif (au plus une fois par 30 s) constate son retour et
   `/api/ready` le dit. Le retour effectif se décide depuis
   `/admin/data` (bouton « basculer vers la primaire »), sauf si
   `FAILOVER_AUTO_RETURN=auto`. Par défaut (`manual`), on ne rentre pas tout
   seul : revenir abandonne les écritures faites sur la secours, et un schéma
   identique ne dit rien des lignes.

## 4. Armement

```bash
# 1. Une base de secours joignable, et son URL dans .env.standby
printf 'DATABASE_URL=%s\n' "$STANDBY_URL" > .env.standby   # jamais dans Git

# 2. Mettre son schéma au niveau du dépôt (ne copie aucune donnée)
npx tsx scripts/db/sync-standby.ts --from="$PRIMARY_URL" --to="$STANDBY_URL"        # simulation
npx tsx scripts/db/sync-standby.ts --from="$PRIMARY_URL" --to="$STANDBY_URL" --apply

# 3. Armer la production (refuse si le schéma n'est pas à niveau)
./scripts/db/configure-failover.sh          # simulation
./scripts/db/configure-failover.sh --apply  # variables Vercel + redéploiement

# 4. Vérifier
curl -s https://devnet-brown.vercel.app/api/ready
```

Couper la bascule :

```bash
./scripts/db/configure-failover.sh --apply --off
```

### Variables

| Variable | Effet |
|---|---|
| `DATABASE_URL` | base primaire |
| `DATABASE_URL_STANDBY` | base de secours ; absente = pas de bascule possible |
| `DATABASE_FAILOVER` | `auto` (défaut) ou `off` |

## 5. Entretien quotidien

La secours prend du retard à chaque migration. Sans entretien, elle devient
inutilisable le jour où on en a besoin. Deux minuteries systemd, installées sur
le poste, s'en chargent :

| Unité | Heure | Rôle |
|---|---|---|
| `devnet-backup.timer` | 03:00 | sauvegarde chiffrée de la base **active** |
| `devnet-sync-standby.timer` | 04:10 | migrations manquantes sur la secours |

```bash
systemctl --user list-timers --all | grep devnet
systemctl --user start devnet-sync-standby.service   # essai immédiat
journalctl --user -u devnet-sync-standby.service -n 20
```

Les unités sont versionnées dans `scripts/systemd/` ; après modification :

```bash
cp scripts/systemd/devnet-*.service scripts/systemd/devnet-*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
```

## 6. Ce que la bascule ne fait pas — et son coût

- **Elle ne réplique pas les données.** La secours contient ce qu'elle contenait
  à sa dernière restauration. Promouvoir, c'est servir des données plus
  anciennes ; tout ce qui a été écrit sur la primaire depuis est invisible
  jusqu'au retour. C'est un choix assumé, pas un détail : `sync-standby` refuse
  explicitement de copier des lignes.
- **Elle ne fusionne pas au retour.** Revenir sur la primaire abandonne les
  écritures faites sur la secours pendant l'incident. Il faut les récupérer à la
  main (les sauvegardes prises par `--active` pendant la bascule servent à ça).
- **Elle ne remplace pas un hébergeur joignable.** Si la secours n'est pas
  configurée, la bascule ne fait rien : `/api/ready` reste `degraded`, ce qui est
  la vérité.

## 7. Diagnostic

| Symptôme `/api/ready` | Sens | Geste |
|---|---|---|
| `status: degraded`, `database: unavailable` | primaire muette, aucune secours | escalader à l'hébergeur ; restaurer une sauvegarde |
| `active: standby` | bascule en cours | vérifier `reason` et `switchedAt`, prévenir |
| `active: standby` + `schemaMatches: false` | les deux bases ont divergé | `sync-standby.ts` avant tout retour |
| `standbyConfigured: false` alors qu'elle devrait l'être | variable absente | `configure-failover.sh --apply` |

Test complet, sans toucher à la production :

```bash
# Deux PostgreSQL 15 jetables (la version de la base réelle).
docker run -d --name fo-a -e POSTGRES_PASSWORD=test -e POSTGRES_DB=devnet -p 55441:5432 postgres:15-alpine
docker run -d --name fo-b -e POSTGRES_PASSWORD=test -e POSTGRES_DB=devnet -p 55442:5432 postgres:15-alpine

# Le schéma complet des deux côtés : sans lui, le test échoue sur
# `public.schema_migrations` avant même de parler de bascule.
DB_TARGET=local npx tsx scripts/db/migrate.ts --database-url=postgresql://postgres:test@localhost:55441/devnet --apply
DB_TARGET=local npx tsx scripts/db/migrate.ts --database-url=postgresql://postgres:test@localhost:55442/devnet --apply

npm run test:failover
docker rm -f fo-a fo-b
```

---

## 8. État mesuré le 2026-11-15 (lecture seule)

| Élément | Valeur mesurée |
|---|---|
| `/api/ready` | `status: ready`, `active: primary`, `standbyConfigured: true` |
| Primaire | Neon `neondb` — joignable, ~185 ms à chaud, **75 entrées** de migration (dernière : `074_audit_chain_utc.sql`) |
| Secours | Systalink — **compute arrêté** : port 33072 ouvert, puis `08P01 server login has been failing, cached error: connect failed (server_login_retry)` ; dernière mesure valide (matin du 15/11) : 75 migrations et mêmes compteurs que Neon |
| Comparaison de schéma | `schemaMatches: null` — empreinte de la secours illisible. **Ce n'est pas un feu vert.** |
| Bascule | `DATABASE_FAILOVER=auto`, retour `manual` |
| Journal d'audit | chaîne vérifiée sur 4 entrées, y compris depuis un fuseau non-UTC |

Trois lectures de ce relevé, et elles comptent autant l'une que l'autre :

- **La production est en ligne** : la primaire Neon répond et porte le schéma
  courant. C'est l'état volontaire après l'incident du 14 novembre, où
  `DATABASE_URL` a été repointée sur Neon.
- **La bascule reste armée** : `withUser` tente la secours dès qu'une
  connexion échoue, et rejoue la requête une fois sur la base promue. Le cas
  13 de `scripts/test-failover.ts` le prouve sur deux vraies bases.
- **La secours n'est pas synchronisée** : Systalink ne répond pas, donc
  `schemaMatches` vaut `null` et un basculement vers elle serait refusé par
  le garde-fou de schéma. Dès qu'elle revient : redémarrer son compute,
  restaurer la dernière archive (voir « Reprise de la secours »), puis
  utiliser « Sonder » et « basculer vers la secours » dans `/admin/data`.

La latence de `/api/ready` inclut la sonde de la cible inactive : une instance
froide paie l'établissement vers la base non servie. Ce chiffre mesure la
sonde, pas le temps de réponse des pages.

### Reprise de la secours — constat du 15/11 vers 10 h

Le proxy Systalink accepte le TCP sur 33072 mais son backend ne répond plus :
`08P01 server login has been failing, cached error: connect failed
(server_login_retry)`. Les ports 5432 et 6543 expirent, 33071 renvoie
`EHOSTUNREACH`, le DNS est stable (`102.164.134.64`). C'est exactement la panne
du 14/11 : **le compute est arrêté, seul le personnel Systalink peut le
redémarrer depuis la console.** Aucune sauvegarde ni restauration n'est
possible avant cela.

Deux pièges corrigés ce jour, à ne pas réintroduire :

- `.env.standby` contenait l'URL **Neon** : `backup.ts --env=standby`
  sauvegardait donc la primaire en croyant la secours. Le fichier a été
  réécrit depuis `DATABASE_URL_STANDBY` (150 octets, mode 600). Toujours
  vérifier la ligne `Hôte … · base devnet` avant d'accepter une archive.
- avec node-pg ≥ 8.16, `sslmode=require` est traité comme `verify-full` et le
  certificat auto-signé de Systalink est refusé. Les scripts `backup.ts` et
  `restore.ts` passent par `pg_dump`/`pg_restore` dans Docker (sémantique
  libpq), ils ne sont pas concernés. Une sonde Node doit ajouter
  `uselibpqcompat=true` à l'URL.

Archive prête à restaurer : `devnet-remote-20261115T090638Z.dump.gpg`
(6 079 915 octets, SHA-256 `19d5e8b8…`, dump de Neon). Commande, une fois le
compute relancé :

```bash
DB_TARGET=remote npx tsx scripts/db/backup.ts --env=standby   # doit afficher base devnet
CONFIRM_REMOTE=devnet npx tsx scripts/db/restore.ts --env=standby \
  --file="$HOME/.local/share/devnet/backups/devnet-remote-20261115T090638Z.dump.gpg" --apply
```

La simulation (sans `--apply`) doit afficher `base devnet` : si elle affiche
`neondb`, la cible est la production — arrêter. Après restauration, vérifier
75 migrations et les compteurs (`users` 43, `posts` 1, `stories` 15,
`notifications` 10), puis `/api/ready`.

### Vérification du basculement (15/11)

- `npm run test:failover` : **13/13** sur deux PostgreSQL jetables
  (74 migrations chacun) — panne franche, base qui accepte le TCP puis se
  tait, schéma divergent refusé, retour gardé par le schéma.
- Chemin de succès éprouvé sur une **vraie base distante** : primaire rendue
  injoignable, secours réelle promue, requête servie (`schema_migrations` =
  75). Le test tourne dans son propre processus : la production n'a pas été
  touchée.
- Refus réel : avec Systalink comme secours, la primaire morte ne provoque
  **aucune** promotion — `active` reste `primary`. Le diagnostic complet
  (inspection dédiée, 8 s) rend la vraie cause : `08P01 server login has been
  failing` — **identifiants refusés**, pas un compute arrêté. La console
  affiche désormais « renouveler le mot de passe dans la console de
  l'hébergeur » au lieu d'un « délai dépassé » qui masquait le problème.
- La bascule **vers Systalink** ne sera prouvée qu'après rotation du mot de
  passe dans la console Systalink, mise à jour de l'URL, puis
  `scripts/db/sync-standby.ts --apply`. `test:failover` prouve le moteur, pas
  la disponibilité de la cible.

---

## 8 bis. Historique — 14 novembre 2026 (bascule d'urgence)

| Élément | Valeur |
|---|---|
| Primaire | Systalink (`postgres-dbaas-…systalinkdatabases.com:33072`) — injoignable, `08P01 server login has been failing` |
| Secours | Neon `neondb`, URL directe (`ep-summer-firefly-…`) |
| `DATABASE_FAILOVER` | `auto` |
| Première bascule | 2026-11-14T17:13:18Z, puis 17:21:04Z au redéploiement suivant |
| État `/api/ready` | `status: ready`, `active: standby`, latence ~95 ms |
| Schéma de la secours | 72 migrations appliquées (+ `029_extensions.sql`, orpheline côté dépôt), 530 colonnes — identique au dépôt ; `071` et `072` appliquées le 14/11 |
| Sauvegarde de la secours | `devnet-remote-20261114T172321Z.dump.gpg`, 6 062 172 octets, SHA-256 vérifiée, copie R2 |

Ce que cela veut dire concrètement : **la production sert les données du
14 novembre au matin**, celles de Neon, pas celles de Systalink. Tout ce qui a
été écrit sur Systalink depuis la dernière synchronisation n'est pas visible.

### Revenir sur la primaire

La sonde de l'endpoint inactif teste Systalink toutes les 30 s et signale son
retour, mais **ne ramène pas la production dessus** : `FAILOVER_AUTO_RETURN`
vaut `manual` par défaut. Le retour se demande depuis `/admin/data`
(« Sonder », puis « basculer vers la primaire » après confirmation). Le bouton
passe par `switchTo()`, donc par les mêmes garde-fous que la bascule
automatique : cible joignable et schéma identique.

Les écritures faites sur la secours pendant l'incident ne seront **pas**
reprises par le retour. Pour ne rien perdre :

1. faire une sauvegarde de la secours avant le retour (`backup-daily.sh`) ;
2. comparer les lignes créées après `switchedAt` avec celles de la primaire ;
3. réinjecter à la main ce qui manque, ou décider de rester sur la secours.

### Prochaine étape recommandée

`DATABASE_URL` doit être repointée sur Neon une fois Systalink déclaré perdu —
sinon chaque instance froide paie une sonde en échec avant de basculer, et un
retour prématuré de Systalink renverrait la production sur une base qui a
perdu la journée. `switch-prod-db.sh` fait cette bascule de variable, il reste
à l'adapter pour lire `.env.standby`.
