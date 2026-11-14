# Sauvegardes et restauration

> Statut : **sauvegarde distante chiffrée effectuée et restauration testée le
> 2026-11-09**. Le dump distant a été restauré dans une base locale vide, puis
> les tests RLS et stories ont passé. La clé de chiffrement reste locale : elle
> doit être déplacée hors machine et la tâche doit être planifiée. La politique
> de sauvegarde Systalink n'est toujours pas connue.

## 1. Objectifs proposés

| Objectif | Valeur cible | Remarque |
|---|---|---|
| RPO (perte de données max) | 24 h | à confirmer avec la politique Systalink |
| RTO (remise en service) | 2 h | restauration locale/autre PostgreSQL testée |
| Rétention | 7 quotidiennes + 4 hebdomadaires | chiffrées, hors du fournisseur |
| Vérification | restauration mensuelle | sur une base jetable, jamais en production |

## 2. Sauvegarde locale et chiffrée — `db:backup`

Le script `scripts/db/backup.ts` produit un dump custom, le chiffre avec GPG
AES-256, écrit une empreinte SHA-256 et applique une rotation. Il ne passe
jamais l'URL ni le mot de passe en argument et n'affiche aucun secret.

```bash
npm run db:backup          # cible locale
npm run db:backup:remote   # cible distante, lecture seule
```

Le client `pg_dump` du poste est PostgreSQL 16 alors que le serveur est
PostgreSQL 18.3 : le script utilise donc l'image `postgres:18.3-alpine` via
Docker (`--network host`). Un `pg_dump` 16 échoue explicitement sur ce serveur.

| Élément | Valeur par défaut |
|---|---|
| Dossier de sortie | `~/.local/share/devnet/backups` (`700`) |
| Fichier | `devnet-<local\|remote>-<horodatage>.dump.gpg` (`600`) |
| Empreinte | `<fichier>.gpg.sha256` (`600`) |
| Chiffrement | GPG symétrique AES-256, phrase de passe dans `~/.config/devnet/backup-passphrase` (`600`) |
| Rotation | 14 sauvegardes récentes (`--keep=<n>`) |
| Options | `--out-dir`, `--passphrase-file`, `--keep`, `--image` |

Créer la phrase de passe sans l'afficher :

```bash
install -d -m 700 ~/.config/devnet
(umask 077; openssl rand -base64 48 > ~/.config/devnet/backup-passphrase)
chmod 600 ~/.config/devnet/backup-passphrase
```

Cette phrase de passe est un **secret de restauration**. La perdre rend les
sauvegardes illisibles ; la laisser sur la même machine que les sauvegardes
protège mal contre un vol ou une panne disque. La déplacer dans un coffre ou
un support hors ligne, avec une copie de secours.

Le script conserve les `GRANT` (indispensables à la RLS) et exclut seulement le
propriétaire (`--no-owner`). Les `GRANT` vers `devnet_u` exigent que ce rôle
existe sur la cible de restauration.

## 3. Sauvegarde distante

Prérequis : le rôle applicatif actuel suffit pour `pg_dump` en lecture ; un
futur `devnet_readonly` réduira encore les droits. `sslmode=require` est utilisé
tant que le CA Systalink n'est pas fourni ; `verify-full` est préférable dès que
`root.crt` est disponible.

### 3.1 Sauvegarde pré-migration du 2026-11-09

Une sauvegarde a été prise **avant** l'application des 52 migrations, sur une
base encore vide de données applicatives :

| Élément | Valeur |
|---|---|
| Fichier | `/tmp/opencode/devnet-remote-pre-migration.dump` |
| Taille | 2 147 octets |
| Mode | `600` |
| SHA-256 | `d06e25fd2a427e79b950fb479cb0a208d51b13ce096088e94cde0fd77ac4d3fc` |
| Chiffrement | **aucun** (`age` absent) |
| Contenu | schéma vide, aucune donnée utilisateur |

Cette sauvegarde prouve la procédure, pas la protection : elle est locale,
temporaire et non chiffrée. Ne pas la considérer comme la sauvegarde de
production.

### 3.2 Sauvegarde chiffrée du 2026-11-09

| Élément | Valeur |
|---|---|
| Fichier | `~/.local/share/devnet/backups/devnet-remote-20261109T020230Z.dump.gpg` |
| Taille | 55 600 octets |
| Mode | `600` |
| SHA-256 | `a8e9474dab71c06d764ba0f03a600eae389de59cf0f78c558b558ff2aa6cdc04` |
| Chiffrement | GPG AES-256, phrase de passe locale `600` |
| Contenu | schéma distant complet, 52 migrations, aucune donnée utilisateur |
| Restauration | ✅ base locale vide, compteurs conformes, RLS et stories verts |

Le dump inclut les objets fournisseur `pgaudit` et `pgbouncer`. Une restauration
portable les exclut : elle obtient 90 fonctions `public` au lieu de 92, et ne
recrée pas le schéma `pgbouncer` ni `_crunchypgbouncer`.

### 3.3 Sauvegarde chiffrée du 2026-11-14

Prise **avant** toute connexion d’écriture à la base Systalink, dans le cadre
de la passe d’exécution. Aucune migration distante n’a été appliquée.

| Élément | Valeur |
|---|---|
| Fichier | `~/.local/share/devnet/backups/devnet-remote-20261114T013251Z.dump.gpg` |
| Taille | 68 765 octets |
| Chiffrement | GPG AES-256, phrase de passe locale `600` |
| SHA-256 | `8691356c9cd7ef9614d6930afcccc1ef45aa9b4bfe1c1c4cfb4f4eecc5cb4402` |
| Cible | base `devnet`, hôte masqué, lecture seule |
| Écriture distante | aucune |

Planification proposée, hors CI :

- tâche quotidienne appelant `npm run db:backup:remote` avec la phrase de passe
  disponible uniquement dans le coffre de la tâche ;
- stockage chiffré hors du fournisseur et hors de la machine qui produit le
  dump ;
- alerte si la tâche échoue ou si la taille du dump dévie de plus de 30 % ;
- rotation déjà appliquée par le script (14 fichiers par défaut), jamais avant
  vérification.

Exemple de minuterie utilisateur, à installer seulement après avoir déplacé la
phrase de passe dans un coffre :

```ini
# ~/.config/systemd/user/devnet-backup.service
[Unit]
Description=Sauvegarde chiffrée DevNet
[Service]
Type=oneshot
WorkingDirectory=/home/laudes/Documents/Hackathon/devnet
ExecStart=/usr/bin/npm run db:backup:remote
```

```ini
# ~/.config/systemd/user/devnet-backup.timer
[Unit]
Description=Sauvegarde DevNet quotidienne
[Timer]
OnCalendar=daily
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl --user enable --now devnet-backup.timer` après validation. Une
sauvegarde locale sur la même machine ne remplace pas une copie hors site.

### 3.3 Minuterie installée (Neon, depuis le 2026-11-13)

La sauvegarde passe par `scripts/db/backup-daily.sh`, qui lit `.env.local` et
utilise `DATABASE_URL_UNPOOLED`. L'URL **directe** n'est pas un détail : le
pooler multiplexe les sessions, et un `pg_dump` à travers lui peut échouer ou
produire une archive incohérente.

```bash
./scripts/db/backup-daily.sh                    # essai manuel
systemctl --user list-timers devnet-backup.timer  # prochaine exécution
systemctl --user start devnet-backup.service      # forcer une sauvegarde
alias revue='journalctl --user -u devnet-backup.service -n 20'
```

Installée le 2026-11-13 : `OnCalendar=*-*-* 03:00:00`, `Persistent=true` (un
rattrapage a lieu si la machine était éteinte), décalage aléatoire de 15 min,
`TimeoutStartSec=15min`. Vérifié par un lancement réel : `Result=success`,
archive de 73 173 octets avec empreinte SHA-256.

À savoir : une minuterie **utilisateur** ne tourne que si la session existe.
Pour qu'elle fonctionne machine éteinte ou personne connectée :
`loginctl enable-linger laudes`.

## 4. Restauration testée

Restauration exécutée le 2026-11-09 depuis le dump chiffré, dans une base locale
vide. Le serveur local et la cible sont PostgreSQL 18.3 : `pg_restore` vient
aussi de l'image `postgres:18.3-alpine`, pas du client 16 du poste.

```bash
BACKUP=~/.local/share/devnet/backups/devnet-remote-20261109T020230Z.dump.gpg
DUMP=/tmp/opencode/devnet-restore.dump
gpg --batch --yes --pinentry-mode loopback \
  --passphrase-file ~/.config/devnet/backup-passphrase \
  --decrypt --output "$DUMP" "$BACKUP"

docker run --rm -v /tmp/opencode:/restore:ro postgres:18.3-alpine \
  pg_restore -l /restore/devnet-restore.dump > /tmp/opencode/devnet-restore.toc
grep -vE "pgaudit|pgbouncer|_crunchy" /tmp/opencode/devnet-restore.toc \
  > /tmp/opencode/devnet-restore-portable.toc

createdb devnet_restore
docker run --rm --network host -v /tmp/opencode:/restore:ro \
  postgres:18.3-alpine \
  pg_restore --host=127.0.0.1 --port=5433 --username=devnet \
  --dbname=devnet_restore --no-owner --exit-on-error \
  --use-list=/restore/devnet-restore-portable.toc \
  /restore/devnet-restore.dump
```

Sur une cible qui n'a pas les rôles propriétaires, créer les rôles référencés
par les `GRANT` avant la restauration : `devnet_u` et, si le dump contient des
privilèges par défaut, `postgres`. Ils restent `NOLOGIN` ; ce sont des porteurs
d'ACL, pas des comptes applicatifs.

Vérifications exécutées sur la base restaurée :

```text
migrations=52  tables=58  policies=178  fonctions=90
triggers=35    realtime=14
```

```bash
npm run test:db-rls
npm run test:stories-postgres
```

Résultats : **17 vérifications RLS** et **41 vérifications stories** passent.
Durée observée : **6,12 s** pour restaurer le schéma vide en local.
Le dump distant contient 92 fonctions `public` ; la restauration portable en
contient 90 car `pgaudit` est exclu. Le schéma `pgbouncer` et `_crunchypgbouncer`
sont également exclus : ils appartiennent au fournisseur, pas à DevNet.

### 4.1 Restauration scriptée — `db:restore`

La procédure manuelle ci-dessus a été automatisée : `scripts/db/restore.ts`
déchiffre l'archive, vérifie l'empreinte SHA-256 quand le `.sha256` est
présent, puis rejoue `pg_restore --clean --if-exists` via l'image PostgreSQL 18.

```bash
npm run db:restore -- --file=<archive.dump.gpg>            # simulation
npm run db:restore -- --file=<archive.dump.gpg> --apply    # écriture
npm run db:restore:remote -- --file=<archive.dump.gpg> --apply
```

Garde-fous, identiques à `db:backup` : sans `--apply` rien n'est écrit ; une
cible `remote` exige `DB_TARGET=remote` **et** `CONFIRM_REMOTE=<nom de la
base>` ; une empreinte différente annule la restauration. `--clean` remplace
les objets existants : la cible redevient exactement l'archive, ce qui est le
comportement voulu pour une bascule et interdit pour une fusion.

Testé le 2026-11-13 : dump local (58 tables, 6 comptes) restauré dans une base
vide → 58 tables, 6 comptes ; refus vérifiés en simulation, sur cible distante
sans confirmation et sur empreinte faussée.

## 5. Dérive du schéma

Comparer la base et le dépôt. Le client `pg_dump` doit être en version 18
(image `postgres:18.3-alpine` si le poste est en 16) ; comparer la cible à une
base reconstruite depuis zéro :

```bash
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges > /tmp/schema-live.sql
npm run db:reset -- --yes
pg_dump "$DATABASE_URL" --schema-only --no-owner --no-privileges > /tmp/schema-repo.sql
diff -u /tmp/schema-repo.sql /tmp/schema-live.sql
```

Filtrer d'abord les objets fournisseur (`pgaudit`, `pgbouncer`,
`_crunchypgbouncer`) : ils ne viennent pas des migrations. Une différence
inattendue sur un objet DevNet est un incident : elle signifie qu'un objet a
été créé hors migrations. Ne pas la corriger à la main en production ; écrire
une migration.

## 6. Bascule d'hébergeur (aller-retour)

Une seule base est **faisante** à la fois : `DATABASE_URL` ne pointe que vers
elle, donc deux bases actives en écriture divergeraient sans réconciliation.
La bascule se fait donc en fenêtre courte, avec une sauvegarde de chaque côté.

**A. Quitter un hébergeur en panne**

1. Créer la base chez le nouveau fournisseur (Neon, région UE, TLS valide).
2. Mettre son URL dans `.env.remote`, `DB_TARGET=remote`, puis
   `CONFIRM_REMOTE=<base> npm run db:migrate:remote -- --apply` → schéma seul.
3. Si une sauvegarde de l'ancienne base existe : `npm run db:restore:remote --
   --file=<archive> --apply` → données.
4. Basculer `DATABASE_URL` sur Vercel, redéployer, vérifier `/api/ready`.

**B. Revenir sur l'ancien hébergeur**

1. Vérifier que la cible répond : `npm run db:probe -- --env=remote`.
2. Sauvegarder la base **active** avant tout : `npm run db:backup:remote`.
3. Restaurer cette archive dans la cible revenue : `npm run db:restore:remote
   -- --file=<archive> --apply`. Le schéma est remplacé par celui du dump.
4. Basculer `DATABASE_URL`, redéployer, vérifier `/api/ready` et un compte.

**Le point à ne pas rater** : l'étape B.2. Les écritures faites sur la base
temporaire après la panne n'existent que là. Sans cette sauvegarde, revenir
sur l'ancien hébergeur revient à perdre tout ce qui a été créé entre-temps.

### 6.1 Reprise automatique dès que la base redémarre — `db:rescue`

Une base arrêtée ne se sauvegarde pas, et personne n'est devant l'écran à la
seconde où un fournisseur la rallume. `db:rescue` comble ce trou : il sonde la
base jusqu'à ce qu'elle réponde, puis enchaîne **immédiatement** sur une
sauvegarde chiffrée. Il ne modifie rien sur la source (`select 1` + lecture).

```bash
npm run db:rescue                    # surveille .env.remote pendant 60 min
npm run db:rescue -- --wait=240      # 4 h (nuit, week-end)
npm run db:rescue -- --interval=15   # sonde toutes les 15 s
npm run db:rescue -- --once          # une seule tentative, diagnostic
```

Codes de sortie : `0` sauvegarde produite, `1` base jamais joignable dans le
délai, `2` erreur d'exécution. Lancez-le dans un terminal qui reste ouvert (ou
en service `systemd`, section 3.3) le jour où vous attendez un redémarrage :
à la première réponse, l'archive est prise **avant** que l'application ne
réécrive dessus.

Enchaînement complet :

1. `npm run db:rescue -- --wait=240` — attend et sauvegarde ;
2. `npm run db:restore -- --file=<archive> --database-url="$DATABASE_URL_UNPOOLED"`
   avec `DB_TARGET=remote` et `CONFIRM_REMOTE=<nom de la base>` — porte les
données vers la base active ;
3. relancer `/api/ready`, vérifier un compte et une publication.

## 7. Ce qui reste à faire

- [x] Prendre une sauvegarde pré-migration et consigner son empreinte.
- [x] Réussir une sauvegarde distante chiffrée GPG.
- [x] Réussir une restauration réelle dans une base locale vide.
- [x] Vérifier les compteurs, la RLS (17) et les stories (41) sur la base restaurée.
- [ ] Déplacer la phrase de passe dans un coffre hors machine.
- [ ] Planifier la tâche quotidienne et surveiller son échec.
- [ ] Stocker une copie chiffrée hors site, hors du fournisseur.
- [ ] Obtenir la politique de sauvegarde Systalink et la durée de rétention.
- [ ] Créer `devnet_readonly` avec le minimum de droits.
- [ ] Rejouer la restauration après la bascule de données réelles.
- [ ] Ajouter une alerte si la taille du dump dévie de plus de 30 %.
