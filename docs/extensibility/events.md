# Événements du cœur — contrat et exploitation

État : Phase 3 livrée le 2026-11-05. Trois événements réels :
`post.created@1`, `proof.verified@1`, `user.registered@1`.

## 1. Contrat

Enveloppe remise à un gestionnaire :

```ts
{
  id: string;              // identifiant de l'événement, stable
  type: string;            // ex. "proof.verified"
  version: number;         // 1
  occurredAt: string;      // ISO 8601 UTC
  actor: string | null;    // "user:<uuid>" pour le cœur
  subject: Record<string, string>;
  data: Record<string, unknown>;
  correlationId: string | null;
}
```

| Événement | `subject` | `data` | Ne contient jamais |
|---|---|---|---|
| `post.created` | `postId`, `authorId` | `postId`, `authorId`, `hasCode` | le texte, le code, le nom |
| `proof.verified` | `proofId`, `userId` | `proofId`, `userId`, `kind`, `projectId` | le résumé, l'empreinte, l'e-mail |
| `user.registered` | `userId` | `userId` | le pseudo, l'e-mail, les langages |

Un abonnement exige la capacité `events:subscribe:<type>@<version>` demandée
dans le manifeste **et** accordée dans `plugin_state.granted_capabilities`.
Sans les deux, `handlersFor` ne remet jamais le gestionnaire.

## 2. Écriture atomique

Les événements ne sont pas publiés par un appel réseau après la mutation. Des
déclencheurs PostgreSQL insèrent dans `event_outbox` **dans la transaction du
fait** :

- `after insert on public.posts` → `post.created` ;
- `after insert on public.proofs` → `proof.verified` ;
- `after insert on public.users` → `user.registered`.

Si la transaction est annulée, l'événement n'existe pas. Les fonctions sont
`security definer`, `search_path` figé, et leur exécution directe est révoquée.
`event_outbox` et `event_deliveries` ont la RLS activée sans politique ; les
privilèges de `anon` et `authenticated` sont retirés. Seule une connexion
PostgreSQL directe autorisée peut lire et écrire ces tables.

Un service du cœur peut aussi appeler l'adaptateur (`enqueue`) dans sa propre
transaction quand les écritures passeront en PostgreSQL direct.

## 3. Livraison

- Garantie **au moins une fois**. Un gestionnaire peut donc être rappelé ; il
  doit être idempotent.
- La clé primaire `(event_id, plugin_id)` rend le stockage idempotent : une
  livraison déjà `delivered` n'est jamais réexécutée.
- Réclamation concurrente : `FOR UPDATE SKIP LOCKED`. Deux instances
  serverless ne traitent pas le même événement.
- Un événement `processing` dont le worker est mort est repris après
  `staleAfterMs` (5 min par défaut).
- Chaque gestionnaire est borné par `handlerTimeoutMs` (5 s par défaut).

Valeurs par défaut du dispatcheur :

| Réglage | Valeur |
|---|---|
| `batchSize` | 10 événements par drainage |
| `maxAttempts` | 5 tentatives par livraison |
| `baseDelayMs` | 2 000 ms |
| `maxDelayMs` | 300 000 ms (plafond) |
| `handlerTimeoutMs` | 5 000 ms |
| `staleAfterMs` | 300 000 ms |

Au-delà de `maxAttempts`, la livraison passe en `failed`, le plugin est mis en
**quarantaine** (`plugin_state.enabled = false`, `health = 'quarantined'`,
`error_count + 1`) et ses livraisons encore ouvertes sont fermées en échec. Un
plugin en quarantaine ne reçoit plus d'événements jusqu'à réactivation par un
administrateur.

## 4. Déclencher le drainage

```bash
# Planificateur : secret porteur
curl -X POST https://app.example/api/events/drain \
  -H "Authorization: Bearer $EVENTS_DRAIN_SECRET"

# Session utilisateur : le navigateur connecté peut déclencher
curl -X POST https://app.example/api/events/drain

# Ne pas attendre la fin : after() exécute le drainage après la réponse
curl -X POST "https://app.example/api/events/drain?background=1"
```

`GET` est accepté pour un planificateur qui ne sait faire que des GET. Sans
`EVENTS_DRAIN_SECRET`, seul un utilisateur authentifié peut déclencher ; sans
`DATABASE_URL`, la route répond `503`.

Une pompe cliente (`components/EventPump.tsx`) appelle le mode `background`
toutes les 60 s quand le backend est en ligne. Sans planificateur, la latence
réelle est donc au plus d'une minute pour un utilisateur actif. Ce n'est pas
une promesse de temps réel.

## 5. Exploitation

```sql
-- Ce qui attend ou a échoué
select type, version, status, attempts, available_at, last_error
  from public.event_outbox
 where status <> 'dispatched'
 order by available_at;

-- Livraisons mortes (file des échecs)
select d.plugin_id, o.type, d.attempts, d.last_error
  from public.event_deliveries d
  join public.event_outbox o on o.id = d.event_id
 where d.status = 'failed'
 order by d.updated_at desc;

-- Plugins en quarantaine
select plugin_id, health, error_count, updated_at
  from public.plugin_state
 where health <> 'ok';
```

Réactiver un plugin après correction est une décision d'administration
(Phase 8). En attendant :

```sql
update public.plugin_state
   set enabled = true, health = 'ok', error_count = 0
 where plugin_id = 'hello-devnet';
```

## 6. Limites assumées

- Le drainage exige `DATABASE_URL` et un rôle autorisé sur les tables
  d'outbox ; PostgREST n'y a pas accès.
- Les gestionnaires n'ont encore ni `store` ni `http` (Phases 6–7) : ils ne
  peuvent pas produire d'effet externe.
- Aucun plugin de production n'est encore abonné ; `hello-devnet` reste sans
  capacité. Les abonnements sont prouvés par les tests et une base temporaire.
- Aucun planificateur n'est configuré dans le dépôt : la pompe cliente et
  l'appel manuel assurent le drainage en attendant.
- Aucun tableau de bord des événements avant la tour de contrôle (Phase 8).
- La latence n'est pas nulle : elle dépend du prochain drainage.
