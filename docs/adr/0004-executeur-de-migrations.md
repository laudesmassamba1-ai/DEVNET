# ADR 0004 — Exécuteur de migrations

- **Date** : 2026-11-04
- **Statut** : accepté
- **Contexte** : Phase 2 (« environnement local reproductible »)

## Décision

Exécuteur maison de ~150 lignes (`scripts/db/lib.ts`) s'appuyant sur `pg`,
appelé par `npm run db:migrate` et `npm run db:reset`.

## Options examinées

| Option | Avantages | Coûts |
|---|---|---|
| **A. `supabase db push` / CLI Supabase** | zéro code, déjà connu du dépôt | rattache la migration à l'outil qu'on retire ; ne fonctionne pas contre une base Systalink nue |
| **B. node-pg-migrate / Knex / Umzug** | outil maintenu, écosystème | dépendance supplémentaire ; oriente vers un DSL JS alors que les 40 migrations existantes sont du SQL brut |
| **C. Exécuteur maison sur `pg`** | SQL inchangé, contrôle total du verrou et des sommes de contrôle, `pg` est de toute façon requis en Phase 5 | on possède les bugs : ils doivent être testés |

## Pourquoi C

1. Les 40 migrations sont du SQL écrit à la main : les réécrire pour un DSL
   serait un risque gratuit.
2. Les deux garanties demandées — refus de rejouer une migration modifiée,
   exécution concurrente impossible — tiennent en un `sha256` et un
   `pg_advisory_lock`, pas besoin d'un cadre complet.
3. `pg` devient la dépendance de la Phase 5 : l'ajouter maintenant ne crée
   pas de dette, contrairement à un outil de migration supplémentaire.

**Risque principal** : une faille dans l'exécuteur laisse la base dans un
état incohérent. Mitigation : chaque fichier s'exécute dans sa propre
transaction (échec = rollback complet du fichier), et le comportement est
vérifié par `scripts/db/test-migrate.ts` (rejeu, dérive, hôte distant).

## Conséquences

- Table `public.schema_migrations` (`name`, `checksum`, `applied_at`,
  `duration_ms`) : source de vérité de l'état appliqué.
- Une migration appliquée **ne se réécrit jamais** ; toute évolution est un
  nouveau fichier (expand → migrate → contract).
- `db/compat/000_compat.sql` est traité comme la première migration : il est
  suivi, rejouable, et seul fichier autorisé à porter des noms Supabase.
- Source unique des migrations : `supabase/*.sql` (001…040).
  `supabase/migrations/` contient trois doublons (038, 040 et un fichier
  `drop extension pg_net`) et n'est pas lu par l'exécuteur ; son sort est
  tranché en Phase 12 avec le renommage en `db/migrations/`.

## Non tranché ici

Le rôle de connexion applicatif. Aujourd'hui les tables appartiennent au
rôle qui migre ; en production l'application devra se connecter avec un rôle
**non propriétaire** pour que la RLS s'applique réellement (piège n°2). Cela arrive avec l'adaptateur Postgres, en Phase 5, et non avant.
