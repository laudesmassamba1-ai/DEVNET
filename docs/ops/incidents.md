# Incidents base de données

## 1. Règle d'or

**Ne rien supprimer, ne rien redimensionner, ne pas redémarrer la base** avant
d'avoir une sauvegarde et l'accord écrit de Laudes. Un incident se diagnostique
d'abord en lecture seule.

## 2. Les cinq premières minutes

1. Noter l'heure, l'utilisateur ou la route concernée, et ce qui a changé juste avant.
2. Vérifier la joignabilité réseau **sans identifiant** :
   ```bash
   nc -vz -w 5 "$DB_HOST" 5432
   ```
3. Vérifier `/api/health` puis `/api/ready`.
4. Regarder les journaux Vercel : message générique côté client, détail côté serveur.
5. Consigner le résultat de `nc`, de `/api/ready` et l'heure exacte dans le ticket.

## 3. Diagnostic SQL (lecture seule)

```sql
select now(), current_user, current_database();
select pid, usename, application_name, state, wait_event_type, wait_event,
       now() - query_start as duration, left(query, 120) as query
  from pg_stat_activity
 where state <> 'idle'
 order by duration desc
 limit 20;

select datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
       temp_files, temp_bytes, deadlocks
  from pg_stat_database
 where datname = current_database();

select pg_size_pretty(pg_database_size(current_database())) as database_size;

select relname, n_live_tup, n_dead_tup, last_autovacuum
  from pg_stat_user_tables
 order by n_dead_tup desc
 limit 20;

select locktype, relation::regclass, mode, granted, pid
  from pg_locks
 where not granted
 order by pid;
```

Ne jamais coller le texte d'une requête contenant un e-mail, un jeton ou un
message privé dans un ticket public.

## 4. Symptômes et pistes

| Symptôme | Piste | Action immédiate |
|---|---|---|
| `nc` refused | rien n'écoute ou base arrêtée | ticket Systalink ; ne pas redémarrer soi-même |
| `nc` timeout | pare-feu / réseau | tester depuis une autre machine, ticket |
| `too many connections` (`53300`) | fuite de connexions ou pool trop grand | baisser `max` du pool, tuer les transactions `idle in transaction` après accord |
| `idle in transaction` long | transaction non fermée | identifier `application_name`, corriger le code, pas tuer en aveugle |
| stockage plein | journaux, bloat, sauvegardes | mesurer, archiver, ne pas supprimer une table sans accord |
| TLS refusé | certificat, `sslmode` | tester `require`, ne pas passer en `disable` sans décision écrite |
| lenteur sur une page | N+1, requête sans index | `EXPLAIN (ANALYZE, BUFFERS)` sur une copie ou en lecture seule |
| `is_admin` incohérent | identité absente ou rôle mal posé | vérifier `withUser`, `current_user`, `session_user` |

## 5. Modèle de ticket Systalink

```
Service : <identifiant du service>
Souscription : 1x-1024-5120
Symptôme : <ce qui échoue, depuis quand>
Heure de début : <ISO 8601, fuseau>
Dernier changement : <migration, déploiement, variable, rien>
Réseau : nc -vz = <succeeded|refused|timeout> depuis <réseau>
TLS : verify-full = <ok|échec>, require = <ok|échec>
Base : joignable = <oui|non>, /api/ready = <statut>
Ce que je n'ai pas fait : aucune suppression, aucun redémarrage, aucun redimensionnement
Demande : <diagnostic|restauration|augmentation|explication>
```

Ne jamais inclure l'URL complète, le mot de passe, une clé ou un dump.

## 6. Fuite de secret suspectée

1. Ne pas réécrire l'historique Git sans accord écrit.
2. Révoquer/renouveler le secret concerné (base, GitHub, drainage).
3. Lancer `gitleaks detect --config .gitleaks.toml --redact`.
4. Vérifier les journaux d'accès de la base (`pg_stat_activity`, logs fournisseur).
5. Consigner dans `docs/ops/` la date, le secret concerné (sans valeur) et la rotation (§6.1).
6. Si le secret est dans un commit, ouvrir un ticket de rotation avant toute réécriture.

### 6.1 Journal des expositions

| Date | Secret | Canal | Rotation |
|---|---|---|---|
| 2026-11-08 | mot de passe du rôle `devnet_u` | collé en clair dans une conversation, plusieurs fois | **faite le 2026-11-09** — `ALTER ROLE devnet_u` ; ancien mot de passe invalide, nouvelle valeur uniquement dans `.env.remote` (`600`, ignoré par Git) |

La rotation est faite et vérifiée : la connexion avec le nouveau secret
fonctionne. L'ancien secret ne doit plus être utilisé. La base reste accessible
depuis `0.0.0.0/0` : aucune donnée réelle d'utilisateur ne doit y être déposée
avant la revue de ce point et la mise en place d'une sauvegarde chiffrée.

## 7. Après l'incident

- Ajouter une entrée dans ce document ou dans `backups.md`.
- Écrire un test qui aurait détecté le problème (RLS, garde-fou, sonde).
- Vérifier qu'une restauration est possible avant de déclarer l'incident clos.
