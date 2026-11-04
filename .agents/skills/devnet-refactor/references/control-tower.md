## 15. Tour de contrôle — console d'administration

**Objectif** : un espace unique, réservé aux administrateurs, pour **observer, comprendre et agir** : publications, états de stockage, données, failles connues, signaux de fuite, tentatives d'intrusion, incidents — avec la possibilité de modifier, ajouter, suspendre et corriger depuis la même interface.

**Principe central : un pouvoir total est une surface d'attaque maximale.** La console est conçue comme la partie la mieux protégée du système, pas la moins.

### 15.1 Limites honnêtes (à dire à Laudes avant de commencer)
- Une console **ne voit pas tout par magie** : elle montre ce qui est **instrumenté**. Ce qui n'est pas enregistré est invisible. L'instrumentation (§15.4) vient donc **avant** les écrans.
- Elle ne **prouve jamais l'absence** de faille ou de fuite. Elle affiche des **signaux** et des **résultats de contrôles datés**. Chaque indicateur montre sa source, sa fraîcheur et sa couverture (« vérifié il y a 3 h, 12 contrôles »).
- **Messages privés** : ne jamais afficher leur contenu par défaut. Métadonnées seulement ; l'accès au contenu se fait par un mode « bris de glace » motivé, journalisé et notifié aux autres admins. Demande à Laudes quelles obligations légales de protection des données personnelles s'appliquent à ses utilisateurs : ne les suppose pas, ne les affirme pas.
- Les données disponibles dépendent des **droits SQL accordés par Systalink** (statistiques de la base, taille, connexions). Quand un droit manque, affiche « indisponible : droit manquant » plutôt que de masquer ou de planter.

### 15.2 Accès et sécurité de la console (non négociable)
- Groupe de routes `/admin` (ou application séparée), `noindex`, réponse **404** (pas 403) pour les non-admins.
- **Rôles** : `owner`, `admin`, `moderator` (contenu), `security` (lecture sécurité + réponse aux incidents), `analyst` (lecture seule). Une matrice permissions × routes, **testée automatiquement**.
- **MFA obligatoire** (TOTP ; WebAuthn en bonus), sessions courtes, **ré-authentification** pour les actions sensibles.
- **Actions destructrices** : aperçu (« 14 éléments seront touchés »), confirmation explicite, suppression douce avec annulation quand c'est possible ; actions critiques (changer le rôle `owner`, purge) soumises à l'approbation d'un second admin s'il y en a au moins deux.
- **Aucun secret affiché en clair** (masqué, 4 derniers caractères). Données personnelles **masquées par défaut** ; « révéler » est une action journalisée.
- **Journal d'audit immuable** `admin_audit_log` : ajout seul (UPDATE et DELETE interdits par droits et par déclencheur), **chaînage de hachages** (chaque ligne contient l'empreinte de la précédente pour détecter toute falsification), avec acteur, action, cible, avant/après (sans données sensibles), IP hachée, agent utilisateur, date serveur.
- Toute mutation admin passe par les **mêmes services et ports** que le reste de l'application, avec un `actor` explicite : **pas de SQL « admin » direct**. Test : toute mutation produit une ligne d'audit.
- CSP stricte, protection CSRF, limitation de débit, en-têtes anti-clickjacking, aucun CORS ouvert.
- Alertes automatiques : connexion admin depuis un contexte inhabituel, changement de rôle, désactivation de MFA, accès « bris de glace ».

### 15.3 Modules

| Module | Ce qu'on voit | Ce qu'on peut faire |
|---|---|---|
| **Radar** (vue d'ensemble) | État global, alertes actives, version déployée, état et latence de chaque service/adaptateur | Accéder en un clic au module concerné |
| **Comptes** | Liste filtrable (rôle, statut de vérification, ancienneté, dernière activité), détail, sessions actives | Créer (remplace `/api/admin/accounts`), changer de rôle, suspendre/réactiver, révoquer les sessions, forcer une réinitialisation, valider/refuser une vérification |
| **Contenu** | Posts, commentaires, projets, preuves, notes, forks, signalements ; messages en métadonnées | Masquer, supprimer (douce), restaurer, modérer, ajouter/éditer des contenus officiels (annonces) |
| **Données & stockage** | Taille de la base, tables (lignes, taille, croissance), index manquants ou inutilisés, requêtes lentes, connexions utilisées vs `max_connections`, état des migrations (appliquées, empreinte, en attente), dernière sauvegarde si disponible, quotas des offres gratuites | Lancer une migration (jamais en production sans aperçu et confirmation), purge ciblée, export |
| **Sécurité** | Voir ci-dessous | Voir ci-dessous |
| **Audit** | Recherche et filtres sur le journal admin et les événements de sécurité | Export, **vérification de l'intégrité de la chaîne** |
| **Incidents & alertes** | Centre d'alertes, chronologie, lien vers `RUNBOOK.md` | Accuser réception, assigner, résoudre, rédiger le post-mortem |
| **Paramètres & drapeaux** | Feature flags, limites de débit, mode maintenance, barèmes (XP, etc.) **en lecture** | Basculer un drapeau, activer la maintenance. Les formules ne se modifient **pas** ici : un changement passe par du code testé |
| **Carte des dépendances** | Chaque port → adaptateur actif → état, latence, dernière erreur | Bouton « tester la connexion ». Prouve visuellement que changer de fournisseur est un changement de configuration |

**Module Sécurité (détail)**
- **Tentatives d'intrusion** : connexions échouées (par compte et par IP hachée), force brute, comptes verrouillés, tentatives d'accès à `/admin`, rafales de 403/404, refus d'autorisation, tentatives d'élévation de privilèges.
- **Failles connues** : un **registre de risques** (`risk_register`) alimenté par les contrôles automatiques (audit des dépendances, détection de secrets, tests RLS, vérification des en-têtes, configuration : MFA admin activé ? secrets anciens à renouveler ? politiques sans test ?). Chaque entrée : gravité, preuve, date de détection, statut (ouverte / en cours / corrigée), lien vers le correctif ou l'ADR. **Initialise-le avec les points de §2.**
- **Signaux de fuite** : exports volumineux, volume de lectures anormal par compte, **honeytokens** (faux comptes et enregistrements appâts qu'aucun usage légitime ne touche : toute lecture déclenche une alerte haute), secrets repérés dans les journaux ou le dépôt, refus répétés de jetons OAuth, partages inattendus.
- **Réponse** : bloquer un compte ou une IP, révoquer sessions et jetons, procédure guidée de **rotation d'un secret**, **interrupteur d'urgence** (mode lecture seule / maintenance globale), ouvrir un incident.

### 15.4 Instrumentation (à construire AVANT les écrans)
- Tables : `security_events`, `admin_audit_log`, `alerts`, `incidents`, `risk_register`, `metric_snapshots`, `feature_flags`, `honeytokens` (nouvelles migrations, jamais d'édition des anciennes).
- **Pas de données personnelles brutes** : IP hachée avec un sel secret rotatif, identifiants pseudonymisés. Définis une **durée de rétention** par table et une purge ; propose des valeurs à Laudes, ne les présente pas comme une règle légale.
- Collecte : un helper unique `recordSecurityEvent()` appelé par les services (authentification, refus d'accès, exports, actions admin). Les métriques sont calculées à la demande avec un cache court et des agrégats à l'écriture : **ne dépends pas des tâches planifiées** du plan gratuit.
- **Contrôles automatiques** : la CI publie ses résultats (audit des dépendances, détection de secrets, tests RLS) vers le registre via une route authentifiée par un jeton de CI stocké en variable d'environnement ; la fraîcheur est affichée.
- Temps réel de la console : via le `RealtimePort` (polling : 5 s sur le Radar, en pause quand l'onglet est caché).

### 15.5 Expérience (cahier des charges de l'interface)
- **Dense, rapide, clavier d'abord** : palette de commandes (Ctrl/Cmd + K) pour naviguer et agir, raccourcis, tableaux virtualisés avec filtre, tri et pagination **côté serveur**, vues enregistrées, export CSV.
- **Hiérarchie d'attention** : ce qui exige une action passe en premier ; l'état normal reste discret, l'anomalie saute aux yeux. Ne colorie pas tout.
- **Identité propre** : pas de grille de cartes SaaS à dégradés. Explore, dans ta direction artistique (§9), des idées comme la métaphore du contrôle aérien (radar des menaces dans le temps et par origine), une frise « pouls » du système, la carte des dépendances comme schéma vivant. Choisis, justifie, fais **une** signature mémorable.
- **États complets** : chargement, vide, erreur, **donnée périmée** (badge de fraîcheur), **dégradé** (droit manquant).
- **Mobile** : un admin doit pouvoir lire une alerte sur son téléphone ; les actions critiques y exigent une ré-authentification.
- **Performance** : chargement par module (Server Components et streaming), graphiques en SVG légers, aucune bibliothèque lourde dans le bundle initial.

### 15.6 Tests de la console
- Matrice routes × rôles générée et vérifiée ; un non-admin reçoit 404 partout.
- Toute mutation admin crée une ligne d'audit ; la chaîne de hachage est vérifiée ; une altération manuelle est détectée.
- Masquage des données personnelles et des secrets (tests d'instantané) ; le « bris de glace » est journalisé et notifié.
- Un honeytoken touché crée une alerte.
- Un droit SQL manquant affiche « indisponible », jamais une erreur 500.
- E2E : connexion admin avec MFA, suspension d'un compte, vérification de la ligne d'audit, annulation.

### 15.7 Priorités de livraison
1. **Version minimale** : Radar, Comptes, Sécurité, Audit (avec MFA et audit chaîné).
2. Contenu et Données & stockage.
3. Incidents, Paramètres, Carte des dépendances.
Livre chaque module comme une tranche verticale testée, pas comme une maquette.

---
