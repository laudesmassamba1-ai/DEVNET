# ADR 0005 — Premier port applicatif : fil et « J’aime »

- **Date** : 2026-11-04
- **Statut** : accepté

## Contexte

Le monolithe existant utilise encore un client compatible Supabase dans de
nombreux domaines. La base Systalink n'est pas disponible pour les essais, et
les migrations SQL supposent actuellement les rôles et fonctions de
compatibilité documentés dans l'ADR 0004.

## Options examinées

| Option | Avantage | Risque ou coût |
|---|---|---|
| Remplacer globalement le client et l'authentification maintenant | Une seule bascule à maintenir | Réécriture sans test de rôle/RLS sur la base cible ; risque de fuite et régression large |
| Ajouter une façade commune autour de l'API Supabase | Peu de changements immédiats | Le contrat reste orienté fournisseur et propage le couplage partout |
| Migrer un cas d'usage vertical avec un port métier | Diff testable, adaptateur changeable, migration réversible | Coexistence temporaire avec l'ancien client et les domaines non migrés |

## Décision

Migrer le fil en premier par cas d'usage : `FeedRepository` porte la lecture
paginée et l'ajout/retrait d'un « J'aime ». `MemoryFeedRepository` réutilise
le backend démo, et `SupabaseFeedRepository` est l'adaptateur transitoire. Le
conteneur de `platform/` réalise le choix d'adaptateur. La façade actuelle de
`lib/social.ts` est conservée provisoirement pour éviter de modifier tous ses
appelants.

## Risque principal

Les autres opérations du fil (création, édition, suppression, commentaires,
réactions et temps réel) continuent d'emprunter les anciens services. La
migration n'est donc pas encore une frontière complète du domaine. Les tests
de contrat verrouillent lecture, pagination, bascule du « J'aime » et erreurs
des opérations migrées ; chaque opération supplémentaire devra être migrée et
testée dans une tranche distincte.

## Hors périmètre

Pas de connexion PostgreSQL applicative, d'`AuthPort`, de polling temps réel,
de nouvelle politique d'autorisation ni de changement de schéma. Ces choix
dépendent de la vérification des droits et de l'accès à la base cible.
