# Contrat UI — tour de contrôle d'administration

## Objectif et état actuel

Console privée pour observer l'état réel du service, gérer les comptes et
traiter les opérations sensibles. La tranche actuelle réutilise l'annuaire et
la file de vérification existants, expose des agrégats de profils/publications/
projets, les barèmes de progression et une unique sonde backend réelle. Les
modules sans instrumentation restent explicitement indisponibles : aucune
donnée de démonstration n'est présentée comme une mesure de production.

## Routes et permissions

| Route | Lecture | Écriture | État |
|---|---|---|---|
| `/admin` | Admin | Comptes et vérifications via services existants | Partiel |
| `/admin/radar` | Admin | Aucune | Sonde PostgREST seulement |
| `/admin/analytics` | Admin | Aucune | Comptages globaux et série hebdomadaire des publications |
| `/admin/data` | Admin | Aucune | Mêmes agrégats ; stockage, migrations et sauvegardes absents |
| `/admin/settings`, `/admin/progress` | Admin | Aucune | Barèmes et paliers en lecture seule |
| `/admin/platform`, `/admin/dependencies` | Admin | Aucune | Sonde backend seulement ; aucun inventaire de dépendances |
| `/admin/team` | Admin | Aucune | Liste réelle des comptes `is_admin` ; pas de rôles granulaires ni d'approbation à deux |
| `/admin/content` | Admin | Aucune | Pas de file globale ; lien vers l'auto-modération personnelle |
| `/admin/security` | Admin | Aucune | À instrumenter |
| `/admin/audit` | Admin | Aucune | À instrumenter |
| `/admin/{incidents,communications,compliance,team}` | Admin | Aucune | À instrumenter |

La permission actuelle est le booléen `users.is_admin`. Les rôles `owner`,
`security`, `analyst` et modérateur de plateforme n'existent pas dans le modèle
actuel. `app/admin/layout.tsx` vérifie la session serveur et relit le rôle en
base ; l'accès absent ou refusé retourne 404 et la route est `noindex`.

### Démonstration sans session serveur

La session de démonstration vit dans `localStorage` : le serveur ne la voit
jamais. Quand aucun backend n'est configuré ou que la démonstration est forcée
(`NEXT_PUBLIC_FORCE_DEMO`), `lib/admin-access.ts` le constate, le proxy et le
layout **ne refusent plus** — un 404 ne protégerait rien et rendrait `/admin`
inaccessible même à un administrateur — et `AdminGate` prend la décision côté
client, sur le profil réellement chargé. Refus par défaut : profil absent,
illisible ou sans `is_admin`.

Dès qu'un backend réel existe sans démonstration forcée, les gardes serveur
reprennent la main (`proxy.ts`, puis le layout), et `AdminGate` ne fait que
confirmer.

## Données connues

- `GET /api/backend-check` renvoie `state`, et éventuellement `status` ou
  `reason`. La sonde vérifie une requête PostgREST ; elle ne mesure ni latence,
  ni sauvegarde, ni migrations.
- Le tableau de bord compte les profils, publications et projets accessibles,
  puis regroupe les publications sur huit semaines. Ces agrégats ne sont ni un
  inventaire de stockage ni une analytique comportementale.
- Les paramètres et la progression lisent `lib/gamification.ts` ; les formules
  restent en lecture seule, sans drapeau global ni mode maintenance.
- La route Contenu n'accorde aucun pouvoir supplémentaire : la file existante
  reste limitée aux personnes concernées par les signalements.
- `fetchAccounts()` et `fetchVerificationQueue()` sont les services existants
  pour `/admin`.
- Les emails d'annuaire sont masqués dans l'interface. Aucun bouton « révéler »
  n'est proposé, car aucun audit de cette action n'existe.
- Le contenu des messages privés n'est jamais présenté.

## Contrats backend requis avant d'activer les autres modules

À créer par le backend, sans modifier l'historique des migrations :

- `admin_audit_log` append-only, chaîne de hachage vérifiable, acteur/action/
  cible/avant-après minimisés, IP hachée et horodatage serveur.
- `security_events`, `risk_register`, `alerts`, `incidents`, `feature_flags`,
  `metric_snapshots` et mécanisme de honeytokens ; rétention à décider par
  l'équipe après examen des obligations applicables.
- Services de lecture filtrée et pagination serveur, toujours derrière une
  permission explicite. Toute mutation reçoit `actor` et produit une ligne
  d'audit dans la même opération.
- MFA TOTP et ré-authentification avant action sensible ; workflow d'approbation
  à deux pour changement de propriétaire et purges. Ces protections ne sont pas
  encore disponibles dans cette tranche.
- Indicateurs de fraîcheur et de couverture pour chaque sonde. Un droit SQL
  manquant doit renvoyer un état explicite « indisponible », jamais une valeur
  nulle présentée comme zéro.

## Cas limites et abus

- Session absente, rôle retiré ou erreur de lecture du rôle : refus fermé.
- Backend injoignable : état hors ligne ou périmé, sans chiffres de secours.
- Les données personnelles restent masquées ; la console ne montre jamais le
  contenu privé sans procédure distincte, autorisée, journalisée et notifiée.
- Les listes futures doivent paginer côté serveur, éviter les exports larges et
  exclure les données directement identifiantes des métriques.
