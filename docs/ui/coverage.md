# Couverture UI — matrice de travail

**Phase B.** Établie le 4 novembre 2026 sur la branche
`refactor/independence`, à partir de `docs/ui/inventory.md`. Une ligne par
surface du catalogue §5. Les doublons entre sections (signalement, partage,
cookies, session expirée…) ne figurent qu'une fois ; les composants
transversaux sont regroupés en §P.

**Statuts**

- `complète` — les sous-écrans de cette ligne existent et fonctionnent. Les
  exigences transverses (i18n, `axe`, E2E, hors-ligne, Lighthouse) restent
  une dette globale : voir §9 de l'inventaire.
- `partielle` — une partie existe ; le manque est nommé.
- `absente` — rien n'existe.
- `écartée` — décision documentée, avec la raison.

**Priorités** : P0 indispensable, P1 important, P2 utile, P3 écarté par
défaut. **Backend** : `existe`, `partiel`, `absent`, `statique`.
**Rôles** : Visiteur, Membre, Modérateur, Admin, Analyste, Owner.

## A. Accès, compte et onboarding

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| A1 | Landing publique | absente | P0 | statique | Visiteur | `/` redirige vers `/feed` ou `/login` ; aucune proposition de valeur ni page indexable. |
| A2 | Inscription | partielle | P0 | existe | Visiteur | 2 étapes (type de compte, identité, pseudo, email, mot de passe, filière/niveau, langages, CGU). Pas de ville, centres d'intérêt, import GitHub, suggestions, première publication. |
| A3 | Connexion | partielle | P0 | existe | Visiteur | Email/mot de passe + comptes de démo. Pas de GitHub OAuth, lien magique ni message de compte suspendu. |
| A4 | Mot de passe oublié / réinitialisation | complète | P0 | existe | Visiteur | Envoi, lien de récupération, nouveau mot de passe et confirmation. |
| A5 | Vérification de l'e-mail | complète | P0 | existe | Visiteur | `/auth/confirmer` gère succès, lien expiré et mode démo. |
| A6 | MFA | absente | P1 | absent | Membre | Aucun second facteur, aucun code de secours. |
| A7 | Connexion avec GitHub | partielle | P1 | partiel | Membre | La liaison GitHub sert à lister/importer des dépôts ; elle ne sert pas à se connecter. |
| A8 | Onboarding guidé | partielle | P0 | partiel | Membre | Langages choisis à l'inscription + visite guidée. Pas de ville, centres d'intérêt, import, suggestions à suivre ni première publication guidée. |
| A9 | États de compte | absente | P0 | absent | Membre | Pas de page compte suspendu/banni/verrouillé, ni motif, durée ou contestation ; session expirée non traitée. |
| A10 | Consentements CGU / confidentialité | partielle | P0 | statique | Visiteur | Case CGU à l'inscription et deux pages légales. Pas d'historique de consentement ni de porte d'âge. |
| A11 | Bandeau cookies et préférences | absente | P0 | absent | Visiteur | Aucun bandeau, aucune préférence par catégorie. |
| A12 | Session et déconnexion | partielle | P0 | existe | Membre | Déconnexion depuis réglages/profil ; pas de session expirée, appareil inconnu ni alerte de connexion. |

## B. Fil, publication et découverte

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| B1 | Accueil / fil | partielle | P0 | existe | Membre | Fil paginé, densité, stories texte, composeur, réactions, commentaires, signets, partage, signalement. Pas de médias, sondage, visibilité, programme, CW ni aperçu complet. |
| B2 | Portées du fil | partielle | P0 | existe | Membre | Tout / Abonnements / Communautés. Pas de « Pour toi » algorithmique, « Par langage » ni « Ma ville ». |
| B3 | Actualisation et nouveaux posts | partielle | P1 | existe | Membre | Temps réel Supabase et « Charger plus ». Pas de tirer-pour-rafraîchir ni compteur « nouveaux posts ». |
| B4 | Compositeur | partielle | P0 | existe | Membre | Texte, bloc de code, langage, rattachement projet, brouillon local. Pas de mentions, hashtags, aperçu global ni récupération après perte réseau. |
| B5 | Images et pièces jointes du post | absente | P1 | absent | Membre | Nécessite stockage, validation serveur, aperçu et modération. |
| B6 | Sondage | absente | P2 | absent | Membre | Aucun modèle, vote ni résultat. |
| B7 | Visibilité du post | absente | P1 | absent | Membre | Pas de public / abonnés / groupe / privé ; le modèle de confidentialité n'existe pas. |
| B8 | Brouillons | partielle | P1 | partiel | Membre | Un brouillon local unique (`devnet:compose`). Pas de liste, nommage, synchronisation multi-appareil. |
| B9 | Publication programmée | absente | P2 | absent | Membre | Aucun planificateur ni file d'envoi. |
| B10 | Avertissement de contenu | absente | P2 | absent | Membre | Pas de CW, pas de floutage. |
| B11 | Aperçu avant envoi | partielle | P1 | existe | Membre | Aperçu du bloc de code seulement ; pas d'aperçu de la carte finale. |
| B12 | Carte de post et actions | partielle | P0 | existe | Membre | Réactions, commenter, repost, signet, partage, signaler, supprimer, modifier. Pas de citer, masquer, bloquer, historique des modifications. |
| B13 | Republier / citer | partielle | P1 | partiel | Membre | Repost simple ; pas de citation avec commentaire. |
| B14 | Partage | partielle | P1 | existe | Membre | Lien, WhatsApp, Telegram, X, LinkedIn, Reddit, email. Pas de partage en message interne, ni intégration, ni QR. |
| B15 | Détail d'un post et réponses | partielle | P0 | existe | Membre | Réponses imbriquées à l'affichage, données à la racine. Pas de tri, permalien de commentaire ni historique. |
| B16 | Explorer | partielle | P1 | existe | Membre | Quatre sections (posts de la semaine, preuves, ateliers, cercles). Pas de personnes, défis, catégories ni tendances par langage. |
| B17 | Page hashtag / sujet | partielle | P1 | existe | Membre | Recherche `?tag=` vers les posts. Pas de route `/tag/[tag]` ni de page sujet. |
| B18 | Page langage | absente | P1 | partiel | Membre | Les langages filtrent les projets, mais aucune page fil/projets/personnes par langage. |
| B19 | Page ville / pays | absente | P2 | partiel | Membre | `ville`/`pays` existent au profil et `AfricaMap` n'est pas branché ; aucune page géographique. |
| B20 | Recherche globale | partielle | P0 | existe | Membre | Personnes, posts, hashtags. Pas de projets, groupes, code, filtres ni suggestions à la frappe. |
| B21 | Historique et recherches enregistrées | absente | P1 | absent | Membre | Rien n'est mémorisé ni effaçable. |
| B22 | Signets et collections | partielle | P1 | partiel | Membre | Signets privés en liste plate. Pas de dossiers, notes, tri ni partage. |
| B23 | Listes personnalisées | absente | P1 | absent | Membre | Aucune curation de comptes. |
| B24 | Mes brouillons, programmés, activité | absente | P1 | partiel | Membre | Pas d'écran agrégé ; l'activité n'est visible que par le profil. |
| B25 | Stories éphémères | partielle | P1 | existe | Membre | Stories texte de 24 h, likes, stickers posés et réponses privées livrées dans la conversation (`direct_messages`, même identifiant de fil que l'écran des messages) — migration 047, `/api/stories`. Pas de média ni de studio de stickers ; `GET /api/stories` mesuré à 638 octets (catalogue seul, 8 stickers) ; interactions testées sur base locale (35 vérifications). |

## C. Profil

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| C1 | En-tête de profil | partielle | P0 | existe | Membre | Avatar, nom, pseudo, bio, ville/pays, liens, langages, score, niveau, série, vérification, suivre/message/signaler. Pas de bannière. |
| C2 | Onglets du profil | partielle | P0 | existe | Membre | Preuves / Publications / Projets ; le profil personnel ajoute Travail / Progrès / Infos / Paramètres. Pas de Réponses, Activité, Groupes, Statistiques, Médias, Likes. |
| C3 | Réputation et progression | partielle | P1 | existe | Membre | Score /1000, paliers, XP, série, quêtes, badges, heatmap, classement local. Pas de page dédiée, ni saisons, ni gels de série. |
| C4 | Modifier le profil | partielle | P0 | existe | Membre | Prénom, bio, ville, pays, langages, liens, couleur d'avatar. Pas de bannière, recadrage, statut, épinglage, centres d'intérêt. |
| C5 | Vue visiteur et profil privé | absente | P1 | absent | Membre | Aucun mode « comme visiteur », aucun profil privé ni demande d'abonnement. |
| C6 | Partage, QR, portfolio / CV | partielle | P1 | partiel | Membre | Lien de profil seulement. Pas de QR, carte ni export portfolio/CV. |
| C7 | Vue recruteur | absente | P2 | absent | Membre | Aucune vue dédiée ni export. |
| C8 | Abonnés / abonnements | partielle | P1 | existe | Membre | `/u/[pseudo]/followers` avec `?which=following`. Pas d'abonnés en commun, recherche ni suggestions. |
| C9 | Menu du profil d'autrui | partielle | P0 | partiel | Membre | Suivre, message, signaler. Pas de bloquer, couper, ajouter à une liste, gérer les notifications du compte. |
| C10 | Profil public sans compte | absente | P0 | existe | Visiteur | Toute la route passe par `AppShell`, donc un lien de profil partagé exige une connexion. |

## D. Réseau et relations

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| D1 | Découvrir des personnes | absente | P1 | partiel | Membre | Recherche par nom/pseudo seulement ; pas de filtres langage/ville/niveau. |
| D2 | Demandes de connexion | écartée | P2 | absent | Membre | Le produit repose sur le suivi asymétrique ; une demande de connexion ajouterait un second modèle relationnel sans cas d'usage validé. |
| D3 | Abonnés / abonnements | partielle | P1 | existe | Membre | Listes consultables ; pas de gestion en masse. |
| D4 | Personnes bloquées | absente | P0 | absent | Membre | Aucun blocage, aucune liste, aucune vérification serveur. |
| D5 | Personnes coupées (muettes) | absente | P0 | absent | Membre | Aucune sourdine. |
| D6 | Mots masqués | absente | P1 | absent | Membre | Aucun filtre personnel. |
| D7 | Annuaire pays / ville et carte | absente | P2 | partiel | Membre | `AfricaMap` existe mais n'est importé nulle part. |

## E. Messagerie

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| E1 | Boîte de réception | partielle | P0 | existe | Membre | Conversations, recherche locale, non-lus, épingles privées. Pas de filtres, archivage, sourdine, suppression de conversation. |
| E2 | Conversation | partielle | P0 | existe | Membre | Texte, code, réponse citée, réactions, édition, suppression, accusés de lecture, frappe, recherche, épingles. Pas de fichiers, images, aperçu de lien, séparateurs de date. |
| E3 | Demandes de message | absente | P1 | absent | Membre | Aucun filtre pour les inconnus. |
| E4 | Nouveau message | partielle | P1 | existe | Membre | Ouverture par `?to=` ; pas de sélecteur de destinataires. |
| E5 | Conversation de groupe | écartée | P3 | absent | Membre | Refusée par `ROADMAP.md` ; coût de modération et de schéma hors périmètre. |
| E6 | Pièces jointes | absente | P1 | absent | Membre | Stockage, validation et antivirus non disponibles. |
| E7 | Appels audio / vidéo | écartée | P3 | absent | Membre | WebRTC et serveur durable incompatibles avec l'offre serverless gratuite ; modération impossible à assumer. |
| E8 | Messages vocaux | écartée | P3 | absent | Membre | Dépend du stockage et de la modération audio, non prévus. |

## F. Communautés et groupes

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| F1 | Découvrir les groupes | partielle | P0 | existe | Membre | Recherche, création, adhésion, « mes groupes ». Pas de catégories ni de confidentialité. |
| F2 | Page de groupe | partielle | P0 | existe | Membre | Canaux, messages, membres, rôles, reçus. Pas de règles, événements, ressources, épinglés. |
| F3 | Création de groupe | partielle | P1 | existe | Membre | Nom et description ; pas d'assistant ni de visibilité. |
| F4 | Adhésion et invitation | partielle | P1 | partiel | Membre | Adhésion directe ; pas de demande, invitation ni approbation. |
| F5 | Paramètres de groupe | absente | P1 | absent | Owner | Pas de confidentialité, qui publie, validation, rôles personnalisés, mots interdits, mode lent. |
| F6 | Gestion des membres | partielle | P1 | existe | Owner, modérateur | Rôles et retrait ; pas de bannissement ni d'historique. |
| F7 | File de modération du groupe | absente | P1 | absent | Modérateur | Aucune file locale. |
| F8 | Journal d'activité du groupe | absente | P2 | absent | Owner | Aucun journal. |
| F9 | Statistiques du groupe | absente | P2 | absent | Owner | Aucune mesure. |
| F10 | Communautés | partielle | P0 | existe | Membre | Liste, recherche, création avec règlement et visibilité, page, adhésion, publications, rôles, réglages staff. Pas de file de modération ni de validation des publications. |

## G. Projets et code

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| G1 | Galerie de projets | partielle | P0 | existe | Membre | Filtres langage/étape/rôle, compatibilité, candidature. Pas de tri ni de tendances. |
| G2 | Créer / importer un projet | complète | P0 | existe | Membre | Création et import GitHub avec historique tronqué. |
| G3 | Page projet | partielle | P0 | existe | Membre | Neuf onglets réels (code, issues, demandes, tâches, candidatures, doc, score, GitHub, réglages). Manque licence et recherche dans le code. |
| G4 | Explorateur et éditeur | complète | P0 | existe | Membre | Arborescence, brouillon, sauvegarde, commits, exécution, Monaco à la demande. |
| G5 | Commits, branches et diffs | complète | P0 | existe | Membre | Historique, branches, différences par révision. |
| G6 | Issues | complète | P0 | existe | Membre | Création, commentaires, fermeture/réouverture, compteur d'onglet. |
| G7 | Revues / pull requests | complète | P0 | existe | Membre | Création, diff, verdict de fusion, fusion confirmée. |
| G8 | Forks | complète | P1 | existe | Membre | Arbre des forks et navigation. |
| G9 | Notes et avis | complète | P1 | existe | Membre | Notation et garde-fous anti-manipulation testés. |
| G10 | Preuves associées | complète | P0 | existe | Membre | Preuves liées au projet et au profil. |
| G11 | Exécution de code | complète | P0 | existe | Membre | Sortie d'exécution, langages supportés, limites. |
| G12 | Sessions collaboratives | partielle | P2 | partiel | Membre | Présence et édition partagée ; pas de salle vocale ni de suivi de curseur complet. |
| G13 | Extensions | partielle | P1 | existe | Membre | Catalogue, installation, publication, extraits, commandes F1. Les thèmes restent décoratifs. |
| G14 | Paramètres du projet | partielle | P0 | existe | Owner, mainteneur | Visibilité, rôles, équipe, recherche de coéquipiers, suppression. Pas de licence, webhooks, transfert, archivage, branche par défaut. |
| G15 | Recherche dans le code | absente | P1 | absent | Membre | Aucune recherche plein texte dans les fichiers. |
| G16 | Bibliothèque de snippets | partielle | P1 | partiel | Membre | Extraits dans le composeur et les extensions ; pas de bibliothèque partageable. |
| G17 | Synchronisation GitHub | complète | P0 | existe | Membre | Liaison, import, polling des commits quand le projet est lié. |

## H. Progression et jeu

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| H1 | Quêtes du jour et défis | partielle | P1 | existe | Membre | Panneau dans l'onglet Progrès ; pas de route `/quests` ni de défi de groupe. |
| H2 | Succès | complète | P1 | existe | Membre | Collection avec progression et compteurs testés. |
| H3 | Badges | complète | P1 | existe | Membre | Galerie, badge courant, explication du palier. |
| H4 | Série, calendrier, gels | partielle | P1 | partiel | Membre | Série affichée ; pas de calendrier ni de gels. |
| H5 | Classements | partielle | P1 | partiel | Membre | Carte de classement dans le profil. Pas de classement global, par langage, ville, amis ou semaine. |
| H6 | Historique d'XP | partielle | P1 | existe | Membre | Courbe et trajectoire de score ; pas de journal d'événements XP. |
| H7 | Saisons / événements limités | absente | P2 | absent | Membre | Aucun modèle. |
| H8 | « Comment ça marche » | absente | P1 | statique | Membre | Barèmes visibles en admin seulement ; aucune explication publique. |

## I. Événements et opportunités

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| I1 | Événements | absente | P2 | absent | Membre | Liste, calendrier, détail, RSVP, rappels, organisation : rien. |
| I2 | Hackathons | absente | P2 | absent | Membre | Aucun modèle ni page. |
| I3 | Offres et opportunités | absente | P2 | absent | Membre | Domaine absent ; décision produit à confirmer. |
| I4 | Mentorat | absente | P2 | absent | Membre | Offre/demande de mentorat absente. |

## J. Notifications

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| J1 | Centre de notifications | partielle | P0 | existe | Membre | Six filtres, regroupement, tout lire, pagination. Pas de types projet/modération/système, ni actions rapides. |
| J2 | Préférences de notification | absente | P1 | absent | Membre | Aucune matrice type × canal, heures calmes, digest, réglage par compte/groupe/projet. |
| J3 | Récapitulatif périodique | absente | P2 | absent | Membre | Aucun digest. |

## K. Signalement et sécurité de l'utilisateur

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| K1 | Modale de signalement | complète | P0 | existe | Membre | Motifs, détails, confirmation, doublon idempotent, auto-signalement masqué. |
| K2 | Bloquer | absente | P0 | absent | Membre | **Promis par l'aide, inexistant.** Aucun modèle, aucune conséquence serveur. |
| K3 | Couper le son (sourdine) | absente | P0 | absent | Membre | **Promis par l'aide, inexistant.** |
| K4 | Notifications de décision et contestation | absente | P0 | absent | Membre | Aucun avis de retrait, avertissement ou suspension, aucune voie de recours. |
| K5 | Suivi de mes signalements | partielle | P0 | existe | Membre | `/moderation` affiche mes signalements et permet de les traiter. Pas de décision staff, motivation ni appel. |
| K6 | Page de sécurité | absente | P1 | statique | Membre | Pas de conseils, détection d'hameçonnage ni journal de connexion. |
| K7 | Procédure de signalement légal | absente | P1 | statique | Tous | Aucune voie dédiée ni escalade. |

## L. Paramètres

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| L1 | Compte | partielle | P0 | existe | Membre | Email, mot de passe, export JSON. Pas de langue du compte, comptes liés complets, désactivation ni suppression. |
| L2 | Sécurité | partielle | P0 | partiel | Membre | Changement de mot de passe. Pas de MFA, codes de secours, clés d'accès, sessions/appareils, historique de connexion, alertes, jetons. |
| L3 | Confidentialité | absente | P0 | absent | Membre | Pas de profil privé, audiences, visibilité d'activité/likes/lecture, indexation, blocages/muets/mots masqués. |
| L4 | Notifications | absente | P1 | absent | Membre | Section informative uniquement ; aucune préférence réelle. |
| L5 | Apparence | partielle | P0 | partiel | Membre | Thème sombre/clair, densité du fil, réduction des animations. Pas d'auto, contraste élevé, taille de texte, police de code, accent, médias. |
| L6 | Accessibilité | partielle | P0 | partiel | Membre | Réduction du mouvement. Pas de contraste, taille, lecteur d'écran, sous-titres, raccourcis. |
| L7 | Langue et région | absente | P1 | absent | Membre | Pas de langue d'interface, fuseau, formats. |
| L8 | Contenu et économie de données | absente | P1 | absent | Membre | Pas de langages d'intérêt, contenu sensible, lecture auto, mode économie de données ou hors-ligne. |
| L9 | Éditeur de code | absente | P1 | partiel | Membre | Monaco utilise des réglages fixes ; pas de thème, taille, tabulations, ligatures, formateur. |
| L10 | Intégrations et développeurs | partielle | P1 | partiel | Membre | Liaison GitHub. Pas d'applications autorisées, jetons d'API ni webhooks. |
| L11 | Données et consentements | partielle | P1 | partiel | Membre | Export JSON depuis le profil. Pas d'historique de consentement, effacement de recherche, suppression de compte. |
| L12 | Aide et à propos | partielle | P1 | statique | Membre | Liens vers l'aide et la confidentialité. Pas de contact, bug, nouveautés, licences, version. |
| L13 | Zone avancée | absente | P2 | absent | Membre | Pas de vidage de cache, diagnostic de connexion ni journaux locaux. |
| L14 | Recherche dans les paramètres | absente | P1 | absent | Membre | Aucune barre de recherche ni index de sections. |

## M. Pages système, aide et légal

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| M1 | Centre d'aide / FAQ | partielle | P1 | statique | Tous | FAQ statique par thèmes. Pas de recherche, catégories dynamiques ni articles. |
| M2 | Contact / support | partielle | P1 | statique | Tous | Adresse de contact. Pas de formulaire ni suivi de demande. |
| M3 | Signaler un bug | absente | P1 | absent | Tous | Aucun formulaire ni suivi. |
| M4 | Suggestions | absente | P2 | absent | Tous | Aucun canal. |
| M5 | CGU | complète | P0 | statique | Tous | Contenu présent ; **relecture juridique requise avant toute affirmation de conformité**. |
| M6 | Politique de confidentialité | complète | P0 | statique | Tous | Contenu présent ; même réserve juridique. |
| M7 | Règles de la communauté | absente | P0 | statique | Tous | Indispensables à la modération et aux sanctions ; absentes. |
| M8 | Politique de cookies | absente | P0 | statique | Tous | Aucune page, aucun bandeau. |
| M9 | Mentions légales | absente | P1 | statique | Tous | Aucune page. |
| M10 | Rapport de transparence | absente | P2 | absent | Tous | Aucune donnée ni page. |
| M11 | Statut du service | absente | P1 | absent | Tous | `/setup` est un diagnostic interne, pas une page de statut publique. |
| M12 | Nouveautés / changelog | absente | P2 | statique | Tous | Aucun journal produit. |
| M13 | À propos et crédits | partielle | P2 | statique | Tous | Présentation et fonctions ; pas de crédits/version. |
| M14 | 404 | complète | P0 | statique | Tous | Page introuvable avec retour. |
| M15 | 403 | absente | P0 | statique | Tous | Admin renvoie 404 ; aucun écran d'accès refusé explicite. |
| M16 | 500 / erreur globale | absente | P0 | statique | Tous | `error.tsx` racine côté client seulement ; pas de `global-error`. |
| M17 | Maintenance | absente | P1 | absent | Tous | Aucun mode maintenance ni lecture seule. |
| M18 | Hors-ligne | absente | P1 | absent | Tous | Aucun bandeau, aucune file d'attente, aucun service worker. |
| M19 | Session expirée | absente | P0 | absent | Tous | Redirection silencieuse vers `/login`, sans explication ni retour au contexte. |
| M20 | Limite de débit atteinte | absente | P2 | absent | Tous | Aucun écran ni délai affiché. |
| M21 | Fonction indisponible | partielle | P1 | statique | Tous | Les modules admin ont un état honnête ; les autres surfaces n'ont pas d'état dédié. |

## N. Modération

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| N1 | Tableau de bord de modération | absente | P0 | absent | Modérateur | Aucune file, délai, charge ni répartition. |
| N2 | File de signalements | absente | P0 | absent | Modérateur | `/moderation` ne montre que les signalements de l'utilisateur. |
| N3 | Dossier d'un compte | absente | P0 | absent | Modérateur | Pas d'historique, appareils hachés, comptes liés ni notes. |
| N4 | Sanctions et actions rapides | absente | P0 | absent | Modérateur | Ignorer, avertir, masquer, supprimer, restreindre, suspendre, bannir : rien. |
| N5 | Notes internes et réponses types | absente | P1 | absent | Modérateur | Aucune macro. |
| N6 | Double validation | absente | P1 | absent | Modérateur, admin | Aucune approbation à deux pour les sanctions lourdes. |
| N7 | Appels / contestations | absente | P1 | absent | Modérateur | Aucune file séparée, aucun réviseur distinct. |
| N8 | Détection automatique | absente | P2 | absent | Modérateur | Aucun mot/lien suspect, aucune heuristique anti-spam. |
| N9 | Modération groupes / projets / preuves / notes | absente | P1 | absent | Modérateur | Aucune file par domaine. |
| N10 | Vérification des comptes | complète | P1 | existe | Admin | File de vérification avec décision et motif. |
| N11 | Journal des décisions et qualité | absente | P1 | absent | Modérateur | Aucun journal, taux d'annulation ni cohérence. |
| N12 | Transparence des sanctions | absente | P1 | absent | Tous | Aucune notification motivée, aucune explication publique. |
| N13 | Bris de glace pour les messages privés | absente | P1 | absent | Modérateur | Aucune procédure journalisée ; l'UI ne doit jamais exposer les MP sans elle. |

## O. Administration

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| O1 | Radar | partielle | P1 | partiel | Admin | Sonde de disponibilité backend seulement. |
| O2 | Comptes | partielle | P0 | existe | Admin | Annuaire, rôles, vérifications. Pas de sessions, appareils, audit par compte. |
| O3 | Contenu | absente | P0 | absent | Admin | File de modération administrative et actions auditées inexistantes. |
| O4 | Données et stockage | absente | P1 | absent | Admin | Aucune sonde de taille, connexions ou migrations. |
| O5 | Sécurité | absente | P0 | absent | Admin | Aucun événement, risque ou signal de fuite. |
| O6 | Audit | absente | P0 | absent | Admin | Journal immuable et chaîne de hachage à construire. |
| O7 | Incidents | absente | P1 | absent | Admin | Aucun registre ni résolution. |
| O8 | Paramètres et drapeaux | partielle | P1 | partiel | Admin | Barèmes en lecture seule ; pas de drapeaux ni maintenance. |
| O9 | Carte des dépendances | partielle | P1 | partiel | Admin | Aucun registre des ports/adaptateurs actifs. |
| O10 | Analytique produit | partielle | P1 | partiel | Admin, Analyste | Volumes et série de publications sur 8 semaines. Pas de cohortes, rétention, entonnoirs, villes/langages. |
| O11 | Communication | absente | P2 | absent | Admin | Aucune annonce, bannière, email ciblé ni planification. |
| O12 | Jeu et progression | partielle | P1 | partiel | Admin | Barèmes consultables ; pas de quêtes, badges manuels ni saisons. |
| O13 | Conformité et demandes | absente | P2 | absent | Admin | Aucun flux export/suppression, support légal ni registre. |
| O14 | Plateforme | absente | P2 | absent | Admin | Jobs, files, limites, maintenance, clés, déploiements, sauvegardes absents. |
| O15 | Équipe et permissions | absente | P1 | absent | Owner | Seul `is_admin` existe ; pas de rôles owner/admin/modérateur/sécurité/analyste. |
| O16 | Approbation à deux | absente | P1 | absent | Admin | Aucune action critique à double validation. |
| O17 | Garde d'accès admin | complète | P0 | existe | Admin | Vérification serveur `is_admin`, 404 et `noindex`. |

## P. Composants transversaux

| ID | Surface | Statut | Prio | Backend | Rôles | Constat / manque principal |
|---|---|---|---|---|---|---|
| P1 | Confirmation destructive | partielle | P1 | n/a | Tous | Confirmations inline pour post/projet ; pas de saisie obligatoire pour les actions lourdes. |
| P2 | Carte de profil au survol | absente | P1 | existe | Membre | Aucun aperçu flottant. |
| P3 | Sélecteur de mentions | absente | P1 | existe | Membre | Mentions saisies à la main. |
| P4 | Sélecteur d'emoji / réactions | complète | P1 | existe | Membre | Palette de réactions livrée. |
| P5 | Lightbox d'images | absente | P2 | absent | Membre | Aucun média de post. |
| P6 | Visionneuse de code plein écran | partielle | P2 | existe | Membre | Éditeur et IDE, pas de visionneuse dédiée depuis un extrait. |
| P7 | Palette de commandes | absente | P1 | n/a | Membre | Pas de `Cmd/Ctrl+K`. |
| P8 | Aide des raccourcis | absente | P1 | n/a | Membre | Raccourcis `g m n s p b v` non documentés dans l'UI. |
| P9 | Toasts avec annulation | partielle | P1 | n/a | Membre | Toasts présents ; aucune action « annuler ». |
| P10 | PWA et installation | absente | P2 | absent | Tous | Pas de manifeste ni de service worker. |
| P11 | Visite guidée | complète | P1 | n/a | Membre | `TourProvider`, arrêts, reprise locale. |
| P12 | Nouveautés | absente | P2 | absent | Tous | Aucun panneau. |
| P13 | Widget de retour d'expérience | absente | P2 | absent | Tous | Aucun canal. |
| P14 | Chargement initial | complète | P1 | n/a | Tous | `SplashScreen` et squelettes de route. |
| P15 | Frontière d'erreur par section | absente | P1 | n/a | Tous | Une seule frontière racine. |
| P16 | Navigation mobile | complète | P0 | n/a | Membre | Barre basse + feuille « Plus », entrée admin conditionnelle. |
| P17 | Panneau contextuel droit | absente | P2 | n/a | Membre | Bureau en deux colonnes seulement. |
| P18 | i18n FR/EN | absente | P1 | absent | Tous | Chaînes françaises en dur ; aucun catalogue de messages. |
| P19 | Contraste élevé | absente | P1 | n/a | Tous | Deux thèmes seulement. |
| P20 | Listes virtualisées | absente | P1 | n/a | Tous | Pagination « Charger plus » ; pas de virtualisation. |
| P21 | Mode économie de données | absente | P1 | n/a | Tous | Aucun réglage ni chargement conditionnel. |
| P22 | Défilement et fil d'Ariane | partielle | P1 | n/a | Tous | Retour contextuel ; pas de restauration de position ni fil d'Ariane cliquable. |
| P23 | Raccourcis clavier complets | partielle | P1 | n/a | Membre | Navigation mono-touche ; pas de palette ni d'aide. |

## Bilan

**199 surfaces recensées** : 24 complètes, 72 partielles, 99 absentes,
4 écartées.

| Priorité | Total | Complètes | Partielles | Absentes | Écartées |
|---|---:|---:|---:|---:|---:|
| P0 | 68 | 16 | 30 | 22 | 0 |
| P1 | 95 | 8 | 38 | 49 | 0 |
| P2 | 32 | 0 | 3 | 28 | 1 |
| P3 | 4 | 0 | 1 | 0 | 3 |

**Le P0 n'est pas livré.** 52 des 68 surfaces P0 sont partielles ou absentes.
Le cœur « dépôt de code » est solide (création, éditeur, commits, issues, PR,
preuves, exécution, signalement, vérification, garde admin). Les manques P0
sont concentrés sur la **confiance et la sécurité** : landing, états de
compte, profil public, blocage, sourdine, décisions et contestation, règles
de la communauté, cookies, confidentialité, pages 403/500/session expirée,
file et sanctions de modération, contenu/audit admin.

**Ordre P0 proposé pour la suite** (après validation artistique) :

1. **Confiance** — blocage, sourdine, mots masqués minimaux, règles de la
   communauté, contestation, pages 403/500/session expirée, cookies.
2. **Modération staff minimale** — file de signalements, dossier de compte,
   sanctions motivées, notification et appel, journal des décisions.
3. **Admin minimal** — contenu, sécurité, audit, paramètres/drapeaux,
   équipe et double approbation.
4. **Accès et croissance** — landing publique, profil public sans compte,
   onboarding minimal, confidentialité, MFA et sessions.
5. **Finitions P0** — états hors-ligne, recherche élargie, paramètres
   essentiels, aide et support.

## Règles de progression

1. **P0 d'abord, entièrement.** Les lignes P0 partielles ou absentes passent
   avant toute P1. Le projet est solide sur son cœur « dépôt de code » ; il
   lui manque surtout les surfaces de **confiance et de sécurité** (blocage,
   sourdine, contestation, règles, cookies, pages d'erreur) et la **file de
   modération**.
2. **Une tranche = une ligne.** Route + composants + tous les états +
   permissions serveur + textes + tests + mise à jour de cette matrice.
3. **Aucune page sans contrat.** Si le backend n'existe pas :
   `docs/ui-contracts/<surface>.md` + port + adaptateur mémoire étiqueté
   démo. Jamais de données inventées servies comme réelles.
4. **Aucune régression silencieuse.** `tsc --noEmit`, ESLint ciblé, suites
   concernées et build avant de clore une tranche. Les tests existants ne
   sont jamais affaiblis.
5. **Décisions à faire valider** : contenu juridique (CGU, confidentialité,
   cookies, règles), suppression de pages existantes, dépendance payante,
   changement de direction artistique déjà validée.

## Écartés et raisons

| Élément | Priorité | Raison |
|---|---|---|
| Appels audio/vidéo, direct | P3 | WebRTC + serveur durable incompatibles avec l'offre serverless gratuite ; modération impossible à assumer. |
| Boutique, paiements, abonnements | P3 | Budget, conformité et fiscalité hors périmètre du concours. |
| Publicité | P3 | Aucun modèle économique ni consentement publicitaire. |
| Stories avec médias | P3 | Les stories texte existent déjà ; les médias ajoutent stockage, transcodage et modération. |
| Messages vocaux | P3 | Dépend du stockage et de la modération audio. |
| DM de groupe | P3 | Refusé par `ROADMAP.md` ; schéma et charge de modération hors périmètre. |
| Demandes de connexion | P2 | Le suivi asymétrique couvre le besoin ; un second modèle relationnel n'est pas justifié. |
| Vue recruteur | P2 | Aucun besoin validé ni parcours de recrutement. |
