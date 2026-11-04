# ADR 0001 — Stratégie de base de données

- **Date** : 2026-11-04
- **Statut** : provisoire ; stratégie distante en attente de l'achat

## Contexte

Le propriétaire indique que la base Systalink n'est pas encore achetée et
qu'il envisage une offre PostgreSQL 17 avec une capacité annoncée de 5 Go.
Cette annonce ne permet pas de confirmer le moteur fourni, les privilèges SQL,
les extensions, l'accès depuis Internet, le SSL, la liste IP, la région ou les
limites de connexions.

L'application utilise encore le client de compatibilité Supabase dans la
plupart des domaines. Le port du fil et du « J'aime » a des adaptateurs mémoire
et Supabase transitoire ; aucun adaptateur PostgreSQL applicatif ni `AuthPort`
n'est câblé.

## Options examinées

| Option | Avantage | Coût / risque |
|---|---|---|
| Garder PostgreSQL 16 en local | Version déjà citée dans le relevé précédent | Désalignement avec la version cible annoncée |
| Aligner l'environnement local sur PostgreSQL 17 | Réduit l'écart de version et permet de préparer les essais | Les migrations et extensions doivent encore être rejouées sur cette version |
| Implémenter immédiatement le pilote distant | Avance le remplacement de Supabase | Impossible de choisir correctement le rôle, le pool, SSL ou la stratégie RLS sans connaître l'offre et ses droits |

## Décision

L'image locale Docker passe à PostgreSQL 17 afin de suivre la cible annoncée.
La capacité de 5 Go est consignée comme une information à confirmer, pas comme
une limite déjà testée. La base distante, le pilote applicatif et la stratégie
d'autorisation restent en attente de l'achat et d'une vérification non
sensible des capacités.

## Risque principal

Une offre dite « PostgreSQL 17 » peut limiter la création des extensions,
schémas ou rôles nécessaires, ou ne pas accepter les connexions depuis
Vercel. Il ne faut donc pas conclure que l'architecture cible est compatible
sur la seule base de l'offre annoncée.

## Vérifications à effectuer après l'achat

Depuis le poste du propriétaire, sans partager les identifiants :

- version exacte, `max_connections` et privilèges du rôle de migration ;
- possibilité d'utiliser `pg_trgm`, `pgcrypto`, un schéma de test et les
  mécanismes de rôle nécessaires ;
- accès réseau depuis Internet, restrictions IP, SSL obligatoire et région ;
- politique de sauvegarde et limites réelles de stockage, connexions et
  transferts comprises dans les 5 Go.

Aucune URL de connexion, aucun mot de passe ni jeton ne doit être transmis
dans la conversation ou versionné.
