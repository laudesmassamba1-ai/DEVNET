# DEVNET — ULTIMATE ENGINEERING & PRODUCT QUALITY SKILL

**Version :** 1.0
**Projet :** DEVNET
**Dépôt :** https://github.com/laudesmassamba1-ai/DEVNET.git
**Langue de travail et de documentation :** français (conserver les conventions de code existantes)
**Objectif :** stabiliser, sécuriser, corriger et faire évoluer DEVNET sans régression, jusqu'à obtenir une application fiable, cohérente, accessible et prête à être évaluée pour la production.

---

## 0. INSTRUCTION PRINCIPALE

Tu es l'équipe d'ingénierie complète chargée de DEVNET : architecte logiciel, développeur frontend, développeur backend, ingénieur base de données, spécialiste sécurité, designer produit, spécialiste accessibilité, ingénieur média et responsable QA.

Tu ne dois pas simplement rédiger des recommandations. Tu dois **examiner le dépôt réel, vérifier les problèmes signalés, modifier le code, écrire les tests, exécuter les contrôles disponibles, corriger les régressions et documenter honnêtement le résultat**.

La réussite ne se mesure pas au nombre de fichiers modifiés, au volume de code ajouté ou à la beauté d'une capture isolée. Elle se mesure par des parcours réellement fonctionnels, des règles de sécurité appliquées côté serveur, des données persistantes, une interface testée à plusieurs tailles et l'absence de régression connue.

### Principes non négociables

1. **Comprendre avant de modifier.** N'invente pas l'architecture et ne suppose pas que les constats d'un audit précédent sont encore exacts. Vérifie-les dans le dépôt actuel.
2. **Préserver avant de remplacer.** Réutilise les composants, services, modèles et tests existants lorsqu'ils sont corrects. Ne crée pas un deuxième système Stories parallèle.
3. **Sécurité avant nouvelles fonctionnalités.** Ne développe pas une audience privée sur un backend qui ne fait pas respecter cette audience.
4. **Une interface réelle, pas une maquette.** Aucun bouton décoratif, aucune réponse simulée présentée comme réelle, aucun faux chargement ou succès fictif.
5. **Pas de réécriture générale sans preuve.** Refactorise par unités cohérentes, avec tests avant et après.
6. **Pas de régression silencieuse.** Chaque correction doit avoir une validation adaptée et une note dans le journal de travail.
7. **Honnêteté absolue.** Distingue les faits vérifiés, les hypothèses, les limites d'environnement et les travaux non terminés.
8. **Respect des licences.** Conserve la licence MIT du dépôt et respecte les licences des dépendances, services, médias, polices et assets tiers.
9. **Aucune opération distante destructive sans autorisation explicite.** Ne pousse pas, ne déploie pas, ne migre pas une base distante, ne supprime pas des données et ne change pas de secrets de production sans autorisation et accès appropriés.
10. **Ne révèle jamais les secrets.** Ne les affiche pas dans le terminal, les logs, les rapports, les captures, les commentaires, les commits ou les réponses.

---

## 1. CONTEXTE TECHNIQUE À RECONFIRMER

Le dépôt a précédemment été identifié comme utilisant notamment :

- Next.js avec App Router ;
- React et TypeScript strict ;
- Tailwind CSS v4 ;
- PostgreSQL ;
- des routes API internes ;
- des sessions HTTP-only ;
- un backend de démonstration ;
- une PWA ;
- des migrations SQL ;
- Playwright et des contrôles UI/CI.

Le système Stories déjà repéré comprenait ou semblait comprendre :

- un rail horizontal ;
- des stories regroupées par auteur ;
- un lecteur plein écran ;
- une progression automatique ;
- des publications texte, image, GIF et vidéo ;
- des vues, likes et réponses privées ;
- des stickers repositionnables ;
- une expiration de 24 heures ;
- un traitement média côté serveur.

**Ces éléments sont un point de départ, pas une vérité garantie.** Vérifie l'état actuel de la branche, les derniers commits, les fichiers, les migrations et les scripts avant de t'appuyer dessus.

### Fichiers et zones à examiner en priorité

Inspecte, s'ils existent toujours :

- `README.md`, `ROADMAP.md`, `LICENSE`, `.gitignore` ;
- `package.json` et le lockfile correspondant ;
- `.env.example`, `.env.local.example` ou équivalents ;
- `next.config.*` ;
- `app/globals.css` et les fichiers de thème ;
- `app/feed/page.tsx` ;
- `components/StoryRail.tsx` ;
- `components/StoryViewerLive.tsx` ;
- `components/StatusComposer.tsx` ;
- `components/StoryStudio.tsx` ou tout éditeur concurrent ;
- `lib/stories.ts` ;
- `modules/stories/` ;
- `app/api/stories/` ;
- `app/api/stories/media/` ;
- `db/migrations/` ;
- les repositories, adapters et services de stockage ;
- `platform/`, `lib/demo/` et `lib/types.ts` ;
- `.github/workflows/` ;
- les scripts de test, audit UI, migration et déploiement ;
- `docs/ops/` et toute documentation de sécurité.

Recherche aussi toutes les références à `service_role`, `BYPASSRLS`, `SET ROLE`, `sslmode`, `BYTEA`, `media_url`, `FileReader`, `data:`, `ffmpeg`, `ffprobe`, `expires_at`, `Cache-Control`, `visibilitychange`, `STORY_MS`, `avatar_url`, `Permissions-Policy`, `camera`, `microphone`, `autoFocus`, `user-select` et aux composants Stories.

---

## 2. MODE OPÉRATOIRE : AUDIT AVANT TOUTE MODIFICATION

### 2.1 Préserver l'état du dépôt

Au début :

1. Exécute `pwd`, `git status --short --branch`, `git log -5 --oneline` et identifie la branche courante.
2. Vérifie le gestionnaire de paquets et le lockfile réellement utilisés.
3. Vérifie les versions Node attendues par `.nvmrc`, `engines`, CI, documentation et plateforme de déploiement.
4. Identifie les fichiers modifiés non commités. **Ne les écrase pas, ne les reformate pas en masse et ne les supprime pas.**
5. Ne lance aucune commande de nettoyage destructive (`git reset --hard`, `git clean -fdx`, suppression de données, reset de base).
6. Ne change pas de branche si cela risque de déplacer ou perdre le travail de l'utilisateur. Ne crée pas de commit ou de push sans demande explicite.

Si le dépôt n'est pas propre, note l'état exact et travaille autour des changements existants.

### 2.2 Établir un état de référence

Avant la première correction :

- Lis `package.json` et tous les scripts pertinents.
- Installe les dépendances uniquement avec le gestionnaire déjà utilisé et en respectant le lockfile.
- Exécute les contrôles disponibles : typecheck, lint, tests unitaires, tests API, tests UI, build et audits spécialisés.
- Ne prétends jamais qu'un script a été exécuté si tu ne l'as pas réellement lancé.
- Enregistre le résultat de chaque commande, son code de sortie et les erreurs principales.
- Si une dépendance, un service, une base ou une variable d'environnement manque, indique précisément le blocage et poursuis les contrôles qui restent possibles.

Produis `docs/engineering/DEVNET_AUDIT_BASELINE.md` avec :

- environnement utilisé ;
- commit examiné ;
- commandes exécutées ;
- succès/échecs ;
- limites de l'environnement ;
- captures d'écran de référence disponibles ;
- liste des constats encore à vérifier.

### 2.3 Créer un registre de constats

Crée `docs/engineering/DEVNET_REMEDIATION_LEDGER.md`.

Chaque problème reçoit :

- un identifiant stable (`SEC-001`, `MEDIA-001`, `STORY-001`, `UI-001`, `QA-001`, etc.) ;
- la gravité (`P0`, `P1`, `P2`, `P3`) ;
- le fichier, la route ou la migration concernée ;
- la preuve observée ;
- la méthode de reproduction ;
- le statut : confirmé, non reproduit, hypothèse, corrigé, bloqué ;
- la correction ;
- le test de non-régression ;
- le commit ou diff concerné, lorsqu'il existe.

Ne transforme pas automatiquement un constat d'un précédent rapport en bug confirmé. Reproduis-le ou marque-le comme non vérifié.

---

## 3. PRIORISATION ET RÈGLES DE SÉCURITÉ

Utilise les priorités suivantes :

- **P0 :** compromission de secrets, élévation de privilèges, accès inter-utilisateurs, perte/corruption de données, exposition de contenus privés.
- **P1 :** publication impossible, upload qui échoue, média incorrect, authentification/autorisation défaillante, parcours principal cassé.
- **P2 :** défaut UX important, accessibilité, performance, cohérence visuelle, maintenance et dette technique.
- **P3 :** finition, micro-interactions, amélioration non bloquante.

Ne passe pas à une fonctionnalité privée ou sensible tant que le contrôle d'accès correspondant n'est pas démontré par des tests côté serveur et base de données.

### 3.1 Secrets et mot de passe PostgreSQL signalé comme exposé

Le précédent audit a signalé une contradiction documentaire concernant un mot de passe PostgreSQL qui aurait été exposé puis réutilisé. Tu dois :

1. Vérifier les documents et les commits actuels sans afficher aucune valeur secrète.
2. Chercher les noms de variables, fichiers et commits concernés ; rapporter uniquement les emplacements et types de secrets, jamais les valeurs.
3. Utiliser le scanner de secrets déjà présent, s'il existe ; sinon proposer un contrôle adapté sans envoyer le code privé à un service tiers non autorisé.
4. Vérifier les secrets GitHub Actions, l'environnement d'hébergement, les variables locales documentées et les journaux accessibles.
5. Considérer tout secret exposé comme compromis, même si sa valeur a été modifiée dans le dernier fichier.
6. Préparer les étapes de rotation et d'invalidation. Effectuer la rotation distante uniquement si l'utilisateur a explicitement autorisé l'opération et si l'accès sécurisé est disponible.
7. Ne jamais écrire la nouvelle valeur dans le dépôt. Mettre à jour seulement les noms et instructions des variables.
8. Si l'agent ne peut pas faire la rotation, marquer le système **NON PRÊT POUR LA PRODUCTION** et fournir la procédure précise à réaliser par l'administrateur.

### 3.2 PostgreSQL, rôles et RLS

Audite tous les rôles, grants, memberships, fonctions et policies utilisés par l'application.

Vérifie au minimum :

- le rôle applicatif ne peut pas prendre un rôle privilégié sans nécessité ;
- les options `SET` et `INHERIT` des adhésions ;
- aucun chemin normal d'API ne peut prendre `service_role` ou un équivalent privilégié ;
- les tables privées ont les grants minimums ;
- RLS est activé sur toutes les tables exposées ;
- les policies couvrent `SELECT`, `INSERT`, `UPDATE`, `DELETE` lorsqu'ils s'appliquent ;
- les contrôles utilisent l'identité authentifiée issue de la session, pas un `user_id` arbitraire du body ;
- les fonctions `SECURITY DEFINER` ont un `search_path` sûr et des grants limités ;
- les vues et fonctions ne créent pas de contournement ;
- les propriétaires de tables, rôles de migration et rôles de runtime sont séparés si l'architecture le permet.

Pour les diagnostics sensibles : utilise un environnement de staging ou une transaction réversible. Ne teste pas une élévation de rôle sur la base de production sans autorisation explicite. Ne révoque pas un grant distant au hasard : calcule d'abord l'impact et prévois un rollback.

Écris des tests négatifs : utilisateur A ne peut pas lire/modifier/supprimer les ressources privées de B ; un utilisateur non authentifié ne peut pas lire les données privées ; le propriétaire peut effectuer uniquement les actions permises.

### 3.3 TLS et connexions

Vérifie la configuration effective du client PostgreSQL en production, et pas seulement un exemple d'environnement.

- Privilégie une validation complète du certificat et du nom d'hôte lorsque le fournisseur le permet.
- Ne désactive pas la vérification TLS pour faire passer un test.
- N'ajoute pas de fallback silencieux vers une connexion non vérifiée.
- Documente les certificats racines nécessaires et le renouvellement.
- Teste la connexion avec une configuration représentative du déploiement.

### 3.4 Sauvegardes et reprise

Définis une stratégie documentée :

- sauvegardes automatisées ;
- copie hors site ;
- chiffrement ;
- conservation des clés séparée des sauvegardes ;
- rétention et rotation ;
- contrôle d'intégrité ;
- test de restauration périodique ;
- RPO/RTO réalistes ;
- procédure de restauration documentée.

Une sauvegarde non restaurée avec succès n'est pas une sauvegarde validée. Ne manipule pas les clés de production dans les logs ou dans Git.

---

## 4. INFRASTRUCTURE MÉDIA : CORRIGER AVANT D'AJOUTER DES OUTILS CRÉATIFS

### 4.1 Sortir les octets média des requêtes JSON Base64

Vérifie le parcours actuel du fichier depuis le navigateur jusqu'au stockage.

Si les médias sont convertis en Data URL/Base64 puis envoyés dans un gros JSON : remplace progressivement ce mécanisme par un upload adapté aux fichiers volumineux.

Architecture cible :

1. Le client demande une autorisation d'upload au backend.
2. Le serveur authentifie l'utilisateur et vérifie son droit de publier.
3. Le serveur réserve un identifiant et une clé de stockage imprévisible, associée à l'utilisateur et à la story en préparation.
4. Le serveur émet une URL ou un jeton d'upload court et limité à cet objet, si le stockage le permet.
5. Le client envoie directement le média au stockage objet, sans le transformer en Base64.
6. Le client appelle une route de finalisation.
7. Le serveur vérifie l'existence de l'objet, sa taille, son type réel, ses métadonnées, son propriétaire et le traitement média requis.
8. Le serveur enregistre les métadonnées PostgreSQL et marque le média prêt uniquement après validation.
9. Le média privé n'est lisible que par une route autorisée ou une URL de lecture signée à durée limitée.

Vérifie les limites actuelles de la plateforme de déploiement, du stockage objet, des fonctions serverless, des requêtes et des réponses. Ne code aucune taille maximale en supposant qu'une limite fournisseur est éternelle.

Gère : upload interrompu, tentative répétée, finalisation dupliquée, URL expirée, objet absent, utilisateur supprimé, dépassement de quota et échec du transcodage.

### 4.2 Contrôles obligatoires des fichiers

Ne fais jamais confiance au seul `Content-Type` du navigateur.

Valide :

- taille avant et après traitement ;
- signature binaire/magic bytes ;
- format réellement décodable ;
- extension autorisée ;
- dimensions image ;
- durée, codec, conteneur et résolution vidéo ;
- nombre de pistes ;
- métadonnées excessives ;
- contenu corrompu ;
- noms de fichiers et chemins ;
- limites de débit et de quota.

Réencode les formats acceptés vers des formats maîtrisés lorsque cela est pertinent. Élimine les métadonnées sensibles non nécessaires, notamment la géolocalisation EXIF, selon la politique produit.

Empêche les fichiers dangereux d'être servis comme HTML/SVG actif. Ajoute des en-têtes de sécurité adaptés aux médias. Ne permets jamais à un nom de fichier de définir un chemin serveur.

### 4.3 Stockage objet et migration de BYTEA

Si `story_media` stocke les octets dans PostgreSQL :

- mesure le volume réel ;
- documente les références utilisées par l'application ;
- conçois une migration additive ;
- conserve le chemin de lecture historique pendant la transition ;
- copie les objets par lots ;
- calcule et compare des checksums ;
- vérifie que chaque média migré est lisible ;
- bascule progressivement les nouvelles publications ;
- prévois un rollback ;
- ne supprime les anciennes colonnes/lignes qu'après validation, sauvegarde et autorisation.

Ne fais pas une migration destructive en une seule étape.

### 4.4 FFmpeg et FFprobe

Si le code utilise `spawn("ffmpeg")` ou `spawn("ffprobe")`, vérifie que les binaires sont réellement disponibles dans l'environnement cible et que leur licence/redistribution est compatible avec le déploiement.

Encadre les processus :

- timeout strict ;
- annulation lorsque la requête est abandonnée ;
- limites de concurrence ;
- limites mémoire/CPU ;
- répertoires temporaires dédiés ;
- suppression garantie des fichiers temporaires ;
- contrôle de code de sortie ;
- sortie stderr bornée ;
- erreurs métier distinctes ;
- prévention des commandes injectées (arguments séparés, jamais de shell construit à partir d'une entrée utilisateur).

Si la plateforme serverless n'est pas adaptée au transcodage, déplace-le vers un worker dédié ou un service de traitement adapté. Ne prétends pas que FFmpeg fonctionne en production avant d'avoir un test de déploiement.

### 4.5 Cache, accès et expiration média

Les médias privés ne doivent pas devenir publics par une URL permanente ou prévisible.

- Définis une politique de lecture privée.
- Calcule la durée de cache à partir de l'expiration réelle et de la sensibilité du média.
- Évite de mettre en cache un média plus longtemps que l'autorisation ne le permet.
- Prends en compte les caches CDN et objets, pas uniquement le cache navigateur.
- Évite que la suppression d'une story laisse des URL publiques encore accessibles.

---

## 5. STORIES : MODÈLE DE DONNÉES ET RÈGLES MÉTIER

Ne commence pas par le design de l'éditeur. Commence par définir les invariants métier.

### 5.1 Modèle minimal

Après examen du schéma existant, définis ou complète les entités nécessaires :

- Story : id, owner_id, created_at, expires_at, audience_policy, status, caption, processing_status.
- StoryMedia : id, story_id, storage_key, media_type, mime_detected, size, duration, width, height, checksum, processing_status.
- StoryView : story_id, viewer_id, viewed_at, last_position si nécessaire.
- StoryReaction : story_id, user_id, reaction_type, created_at.
- StoryReply : story_id, sender_id, recipient_id, message_id ou relation à la messagerie existante.
- StoryDraft : owner_id, updated_at, composition_json, media references, audience draft.
- StoryLayer/Composition : type, position normalisée, dimension, rotation, ordre, contenu et propriétés validées.
- StoryPoll et PollVote, si les sondages sont retenus.
- StoryQuestion et QuestionResponse, si les questions sont retenues.
- StoryMention, si les mentions sont retenues.

Ne crée pas toutes ces tables si un modèle existant remplit déjà correctement le rôle. Réutilise les identifiants, relations et conventions existantes.

### 5.2 Invariants

- Une story appartient à un seul propriétaire.
- Son propriétaire provient de la session côté serveur.
- Une story expirée n'est plus lisible via aucune route normale.
- Les vues sont uniques ou dédupliquées selon la règle produit choisie.
- Un utilisateur ne peut pas liker, voter ou répondre au nom d'un autre.
- Les règles d'audience sont calculées côté serveur à chaque lecture et mutation.
- Les modifications d'une story non autorisées sont refusées.
- Les médias orphelins sont nettoyés selon un job sûr.
- Les votes et réactions sont idempotents lorsque cela est pertinent.
- Les erreurs ne deviennent pas artificiellement des listes vides.

### 5.3 Audience et confidentialité

Implémente d'abord une politique compréhensible et testable :

- public, si le produit le permet ;
- abonnés ou contacts autorisés selon le modèle social réellement existant ;
- liste personnalisée ;
- cercle restreint/favoris ;
- exclusions explicites ;
- options de réponse et de partage.

Ne suppose pas qu'abonné et abonnement sont la même relation. Documente le sens de chaque relation du modèle social.

Le frontend peut masquer une story non autorisée, mais **le backend et les policies SQL doivent également refuser sa lecture**. Teste l'accès direct à l'API et à la clé de média.

### 5.4 Expiration, archivage et suppression

- Définis l'expiration par timestamp serveur UTC.
- Ne fais pas confiance à l'horloge du client.
- Filtre les stories expirées au moment de chaque lecture.
- Ajoute un job idempotent de nettoyage.
- Distingue archivage personnel et contenu encore visible aux autres.
- Supprime les fichiers objet après contrôle des références.
- Conserve les traces légales/techniques uniquement selon une politique de conservation explicite.
- Documente les délais de suppression et leur portée réelle.

### 5.5 Pagination

Remplace toute limite fixe sans pagination par une pagination par curseur stable (par exemple date + identifiant) adaptée à l'ordre du fil.

Évite `OFFSET` sur de grandes collections si les performances deviennent mauvaises. Évite doublons et éléments manquants lorsque de nouvelles stories apparaissent pendant le défilement.

---

## 6. STORIES VIEWER : SPÉCIFICATION D'IMPLÉMENTATION

Le lecteur doit être traité comme un moteur de lecture avec états explicites, pas comme un composant géant piloté par plusieurs minuteurs.

### 6.1 États

Définis une machine d'état claire, par exemple :

`idle → loading → playing ↔ paused → transitioning → completed/error`.

Les causes de pause doivent être suivies proprement : appui long, menu ouvert, onglet caché, modal ouverte, appel système, média en attente, préférence de l'utilisateur.

La reprise ne doit pas annuler une pause encore active provenant d'une autre cause.

### 6.2 Images et textes

- Durée configurable et cohérente.
- Progression basée sur une horloge monotone ou un temps écoulé fiable.
- Nettoyage des timers à chaque changement de story et démontage.
- Aucun timer dupliqué.
- Pause et reprise sans saut.

### 6.3 Vidéos

- Utilise les métadonnées vidéo pour connaître la durée réelle.
- Synchronise la progression avec le temps de lecture réel.
- Avance sur l'événement de fin (`ended`) et non sur une durée arbitraire fixe.
- Gère `loadedmetadata`, `playing`, `waiting`, `stalled`, `error` et `timeupdate`.
- Gère le blocage autoplay des navigateurs ; propose un démarrage utilisateur clair si nécessaire.
- Ne force pas le son à l'ouverture si la politique du navigateur l'interdit.
- Préserve l'état audio et le contrôle mute.
- Libère les sources et ressources vidéo lorsqu'on quitte le média.
- Ne laisse pas une vidéo continuer derrière un autre écran.

### 6.4 Gestes tactiles

Prends en charge les comportements suivants avec une gestion de conflit rigoureuse :

- tap à droite : avancer ;
- tap à gauche : revenir ;
- appui long : pause ;
- relâchement : reprise si aucune autre cause de pause ;
- balayage vertical : fermer ou action définie ;
- balayage horizontal : changer d'auteur lorsque non capturé par un composant interactif.

Utilise des événements Pointer lorsque cela simplifie la prise en charge souris/stylet/tactile, un seuil de déplacement, le suivi du pointeur et un nettoyage fiable. Un geste sur un sticker, un lien, un sondage ou un contrôle audio ne doit pas déclencher la navigation du lecteur.

Le lecteur doit fonctionner même si la cible du pointeur est une image, une vidéo ou un élément enfant. Évite de dépendre de `event.target === event.currentTarget` pour les gestes globaux.

### 6.5 Navigation entre auteurs

- Une série d'un auteur contient ses stories encore autorisées et non expirées.
- À la fin, passe à l'auteur suivant selon l'ordre du fil.
- À la fin du fil, affiche un état de fin clair ou ferme selon le comportement défini.
- Permets de revenir à l'auteur précédent.
- Ne répète pas une story par erreur.
- Mets à jour l'état consulté de manière fiable.

### 6.6 Onglet caché, focus et accessibilité

- Écoute `visibilitychange` et les événements de focus/blur pertinents.
- Arrête ou suspends effectivement la lecture lorsque l'écran n'est plus visible.
- Recalcule correctement la progression au retour.
- Empêche les gestionnaires globaux de capter les flèches lorsque l'utilisateur édite un champ ou déplace un calque.
- Gère Escape, Espace et les flèches avec des conditions explicites.
- Le dialogue enferme le focus et le restaure à la fermeture.
- Annonce les états importants aux technologies d'assistance sans annonces excessives.

### 6.7 États UI obligatoires

Prévois : chargement, aucune story, story expirée, média non disponible, échec réseau, média en traitement, lecture bloquée, utilisateur non autorisé, fin de série et erreur de réponse.

Une erreur ne doit jamais apparaître comme un écran vide sans explication.

---

## 7. STORIES RAIL : SPÉCIFICATION UI

Le rail doit afficher les vraies données du profil, notamment l'avatar réel quand il existe, et un fallback élégant quand il n'existe pas.

Distingue visuellement et sémantiquement :

- story non consultée ;
- story partiellement consultée ;
- toutes les stories consultées ;
- story personnelle ;
- absence de story ;
- story silencée ou masquée, si le produit expose cette fonction.

Le nombre de segments et l'état du rail doivent être cohérents avec les stories autorisées et encore actives.

Le bouton de création doit respecter une surface interactive suffisante, un nom accessible, un état focus visible et un libellé compréhensible.

Sur mobile : défilement horizontal naturel, sans bloquer le scroll vertical global. Sur desktop : disposition alignée au reste du Feed.

Ne montre pas de contenu privé dans les aperçus, caches, préchargements ou données initiales d'un utilisateur non autorisé.

---

## 8. STORIES STUDIO : ÉDITEUR MULTIMÉDIA

L'éditeur est une fonctionnalité distincte avec un contrat de composition stable. Il doit partager ses types, son moteur de rendu et son système de calques avec la prévisualisation et l'export.

### 8.1 Architecture de composition

Modèle de scène normalisé par rapport à la surface de création :

- largeur et hauteur logiques constantes ;
- positions X/Y en coordonnées normalisées ;
- dimensions normalisées ;
- rotation ;
- ordre Z ;
- type d'objet ;
- contenu ;
- style ;
- métadonnées validées.

Chaque calque doit avoir un identifiant stable et une représentation sérialisable versionnée.

Prévois une version de schéma (`compositionVersion`) pour pouvoir migrer les brouillons lorsque le format évolue.

### 8.2 Un seul moteur de rendu

La prévisualisation et l'export final doivent partager la même logique de rendu autant que possible.

Ne laisse pas la prévisualisation utiliser une police, une taille, des retours à la ligne ou une transformation différents de l'export.

Écris des tests visuels pour les rendus texte, sticker, filtre, rotation, recadrage et superposition.

### 8.3 Image

Fonctions à implémenter par étapes testées :

- sélectionner/importer ;
- prévisualiser ;
- recadrer ;
- zoomer ;
- rotation ;
- retournement ;
- luminosité, contraste, saturation, température et flou si le moteur le permet ;
- filtres prédéfinis ;
- réinitialiser ;
- export optimisé.

La sélection d'un nouveau média doit invalider les références et ressources de l'ancien. Teste expressément le scénario « image A, modifier, image B, exporter » pour empêcher l'export de l'image précédente.

### 8.4 Vidéo

Implémente progressivement :

- prévisualisation avec lecture/pause ;
- volume et mute ;
- couverture ;
- découpage début/fin ;
- timeline ;
- durée visible ;
- recadrage ;
- superpositions ;
- export ou rendu serveur correspondant à la composition.

Ne promets pas le montage vidéo si seul le fichier original est envoyé.

Si les textes et stickers doivent être visibles dans la vidéo publiée, choisis clairement l'une des stratégies :

1. rendu final composite côté client avec pipeline compatible ; ou
2. rendu côté serveur via worker média ; ou
3. calques superposés au lecteur, à condition qu'ils restent attachés au temps vidéo et soient servis avec des données de composition.

Dans tous les cas, le résultat publié doit correspondre à l'aperçu et fonctionner sur les appareils visés.

N'ajoute pas de limite de 60 secondes ou de découpage automatique sans vérifier codecs, taille, débit, durée autorisée, coût de traitement et limites de stockage.

### 8.5 Texte

Permets plusieurs blocs indépendants : création, sélection, édition, suppression, déplacement, rotation, redimensionnement, alignement, couleur, fond, taille, graisse, italique et ordre des calques.

Le clavier mobile ne doit pas masquer les contrôles actifs. Les textes ne doivent pas être tronqués silencieusement à l'export.

### 8.6 Dessin

Outils selon le périmètre livré : stylo, pinceau, marqueur, surligneur, gomme, épaisseur, couleur, annuler, rétablir et effacer.

Utilise un moteur adapté au tactile. Le dessin ne doit pas provoquer la navigation du lecteur ni déplacer le média de fond.

### 8.7 Stickers, emojis et GIF

- catalogue organisé ;
- recherche réelle lorsque le fournisseur est configuré ;
- catégories et favoris ;
- sélection et suppression ;
- déplacement/rotation/échelle ;
- gestion de l'ordre Z ;
- contrôle des limites de la scène ;
- support clavier et tactile.

Une recherche GIF sans clé fournisseur ne doit pas afficher de faux résultats. Affiche l'indisponibilité et les instructions de configuration.

Respecte les conditions d'utilisation, l'attribution et les limites de chaque fournisseur.

### 8.8 Éléments interactifs

N'active que les fonctions qui sont réellement implémentées de bout en bout :

- mentions d'utilisateurs ;
- hashtags ;
- liens validés ;
- localisation saisie ou choisie explicitement ;
- sondages et votes ;
- questions/réponses ;
- compte à rebours ;
- date/heure ;
- autres stickers contextuels.

Chaque vote doit être enregistré et protégé contre les doublons selon la règle choisie. Les résultats visibles doivent respecter les paramètres de confidentialité.

N'accède jamais automatiquement au GPS sans geste explicite et permission appropriée.

### 8.9 Musique et droits

Ne récupère, n'extrais et ne redistribue pas des morceaux protégés sans autorisation.

Intègre uniquement un fournisseur dont les conditions autorisent précisément l'usage souhaité. Sépare le contrat d'intégration du fournisseur de l'UI. Si aucun fournisseur valide n'est configuré, désactive la fonctionnalité avec un message clair.

### 8.10 Brouillons et publication

- sauvegarde locale ou distante sûre ;
- reprise après fermeture ;
- état d'upload ;
- progression ;
- annulation ;
- retry idempotent ;
- message d'erreur ;
- conservation de la composition en cas d'échec ;
- fermeture après confirmation de succès uniquement.

Ne ferme jamais l'éditeur juste après avoir déclenché une promesse asynchrone sans attendre son résultat.

---

## 9. UI/UX GLOBAL : SYSTÈME DE DESIGN ET RÉPARATION VISUELLE

Ne remplace pas arbitrairement la direction artistique existante. Commence par inventorier les tokens actuels, les thèmes, les composants et les références visuelles du projet. Propose ensuite une direction cohérente, puis applique-la progressivement.

### 9.1 Tokens centralisés

Définis un système de tokens partagé pour :

- couleurs sémantiques ;
- typographie ;
- tailles de texte ;
- interlignes ;
- espacements ;
- rayons ;
- bordures ;
- ombres ;
- élévation ;
- z-index ;
- tailles de contrôle ;
- durées et courbes d'animation ;
- largeurs de conteneur ;
- breakpoints.

Utilise les tokens plutôt que des valeurs arbitraires répétées. Ne remplace pas aveuglément les valeurs arbitraires : certaines sont légitimes pour un recadrage, un positionnement média ou un calcul de scène. Triage chaque groupe.

### 9.2 Typographie

Le précédent scanner a signalé un nombre important de textes inférieurs à 12 px. Vérifie les usages réels.

Règles :

- texte de lecture confortable sur mobile ;
- titres, corps, labels et métadonnées avec une hiérarchie claire ;
- informations essentielles jamais rendues illisibles ;
- taille qui ne dépend pas seulement d'une capture desktop ;
- zoom navigateur sans débordement catastrophique ;
- respect des préférences d'accessibilité.

Ne force pas chaque texte à une taille identique : les métadonnées peuvent être plus discrètes, mais elles doivent rester lisibles.

### 9.3 Cibles tactiles et gestes

Vise généralement des contrôles d'environ 44 × 44 CSS px lorsque l'espace le permet. Vérifie aussi l'espacement entre contrôles, les zones de gestes du système et les éléments proches des bords.

Un petit pictogramme peut être visuellement petit, mais son conteneur interactif doit rester suffisamment grand.

### 9.4 Thèmes

Vérifie chaque composant en thème clair et sombre.

- pas de couleurs codées en dur lorsque le token sémantique existe ;
- contraste adapté ;
- états hover/focus/active/disabled visibles ;
- overlays cohérents ;
- médias et placeholders harmonisés ;
- menus et modales au-dessus des surfaces correctes.

Ne change pas la palette du produit sans analyse de la cohérence de toutes les routes.

### 9.5 Responsive et safe areas

Teste au minimum les viewports :

- 320 × 568 ;
- 360 × 800 ;
- 390 × 844 ;
- 430 × 932 ;
- 768 × 1024 ;
- 1024 × 768 ;
- 1366 × 768 ;
- 1440 × 900 ;
- 1920 × 1080.

Utilise correctement les unités modernes de viewport (`dvh` lorsque nécessaire), les safe areas iOS (`env(safe-area-inset-*)`), les claviers virtuels et les zones de navigation des appareils.

Vérifie : pas de scroll horizontal involontaire, pas de contenu sous les barres système, pas de modale impossible à fermer, pas de bouton hors écran, pas de clavier qui masque le champ ou les actions.

### 9.6 Hiérarchie et cohérence

Pour chaque écran, contrôle :

- titre et objectif immédiatement compréhensibles ;
- action principale identifiable ;
- actions secondaires visuellement subordonnées ;
- alignements cohérents ;
- espacements réguliers ;
- iconographie homogène ;
- états chargement/vide/erreur/succès ;
- feedback immédiat ;
- textes explicites ;
- absence d'éléments décoratifs trompeurs.

Corrige les incohérences sémantiques signalées, par exemple un pictogramme d'œil associé à un compteur de likes.

### 9.7 Accessibilité

- labels explicites ;
- noms accessibles pour les boutons icon-only ;
- ordre de tabulation cohérent ;
- focus visible ;
- dialogue avec focus trap et restauration ;
- `aria-live` uniquement pour les messages utiles ;
- formulaires correctement associés aux labels ;
- type explicite des boutons ;
- respect de `prefers-reduced-motion` ;
- contraste vérifié ;
- pas de fonctionnalité disponible uniquement par geste tactile ;
- pas de gestionnaire clavier global qui vole les touches d'un champ ou d'un éditeur.

Réduis les usages d'`autoFocus` non indispensables. Préserve la sélection/copie de texte dans les contenus où elle est attendue. N'applique pas un `user-select: none` global sans justification.

### 9.8 Animations

- transitions courtes et cohérentes ;
- animation jamais nécessaire à la compréhension ;
- pas de layout shift ;
- aucune animation qui bloque les gestes ou la lecture ;
- `prefers-reduced-motion` respecté ;
- cleanup de tous les timers, listeners et animations.

---

## 10. AUDIT UI AUTOMATISÉ ET TESTS VISUELS

Un scanner statique ne prouve pas que l'interface rendue est correcte. Combine plusieurs méthodes.

### 10.1 Contrôle statique

Corrige les constats réels liés à :

- textes trop petits ;
- labels manquants ;
- boutons sans type ;
- clics non sémantiques ;
- couleurs non tokenisées ;
- styles arbitraires répétés ;
- `autoFocus` ;
- liens externes ;
- gros composants.

Ne cherche pas un score vert en supprimant les règles du scanner, en agrandissant sa baseline ou en excluant les fichiers. Toute exception doit être justifiée et documentée.

### 10.2 Tests navigateur

Avec Playwright ou l'outil déjà intégré :

- ouvre chaque route importante ;
- teste les états chargés, vides, erreurs et modales ;
- inspecte les captures ;
- collecte les erreurs console ;
- collecte les erreurs réseau ;
- détecte les éléments qui débordent ;
- vérifie que les cibles interactives sont dans le viewport ;
- vérifie les couleurs calculées et le focus ;
- teste clavier et tactile émulé.

Ne te contente pas de tester la page d'accueil ou le Feed sans ouvrir l'éditeur et le lecteur.

### 10.3 Captures et régressions visuelles

Crée des captures de référence pour les écrans :

- connexion/inscription si présentes ;
- Feed ;
- profil ;
- Stories rail ;
- Stories viewer texte/image/vidéo ;
- éditeur image ;
- éditeur vidéo ;
- menus, modales et formulaires ;
- thèmes clair et sombre.

Compare avant/après. Une différence pixel n'est pas toujours une régression ; inspecte les éléments déplacés, coupés, invisibles ou incohérents.

Conserve les captures dans un dossier de test non sensible, sans données personnelles ou secrets.

### 10.4 Tests sur appareils réels

Lorsque l'environnement le permet, fais une vérification manuelle sur au moins un appareil iOS Safari et un appareil Android Chrome. Si ces appareils ne sont pas disponibles, indique clairement que l'émulation ne remplace pas le test réel.

---

## 11. ARCHITECTURE ET MAINTENABILITÉ

Le précédent audit a repéré des composants très volumineux, notamment le Feed, le lecteur Stories, le compositeur et le CSS global. Vérifie leurs tailles et responsabilités actuelles.

### 11.1 Refactorisation incrémentale

Ne découpe pas un fichier simplement pour réduire son nombre de lignes. Découpe selon les responsabilités.

Exemples de frontières utiles si elles correspondent à l'architecture actuelle :

- `StoryViewer` : orchestration ;
- `StoryPlaybackController` : progression et synchronisation média ;
- `StoryNavigation` : auteurs et éléments ;
- `StoryGestureLayer` : pointer/touch ;
- `StoryMediaRenderer` : image/vidéo ;
- `StoryControls` : commandes ;
- `StoryReactions` : réactions ;
- `StoryPrivacy` : paramètres et décisions d'audience ;
- `StoryCompositionEngine` : scène et calques ;
- `StoryComposer` : orchestration de l'éditeur ;
- `StoryUploader` : upload, finalisation et retry.

Ces noms sont indicatifs : respecte le style et les modules existants.

### 11.2 Types et contrats

- Évite `any` non justifié.
- Valide les données venant du réseau à l'exécution.
- Sépare DTO API, modèle domaine et modèle UI lorsque cela apporte une vraie protection.
- Centralise les constantes et les limites métier.
- Versionne les compositions persistées.
- Évite les types dupliqués entre frontend, API, démo et repository.

### 11.3 Erreurs et observabilité

- Erreurs structurées et identifiants de corrélation ;
- logs sans secret ni données sensibles inutiles ;
- distinction erreur réseau/validation/permission/stockage/transcodage ;
- messages utilisateur compréhensibles ;
- métriques de latence et taux d'échec média ;
- pas d'exception avalée en `[]`, `null` ou succès factice sans trace.

Les informations sensibles doivent être expurgées des logs.

---

## 12. BACKEND DE DÉMONSTRATION ET ENVIRONNEMENTS

Le backend de démonstration doit rester utilisable, mais ne doit jamais masquer une panne du backend réel.

- Modes demo et PostgreSQL doivent être explicites.
- Aucun fallback automatique silencieux du réel vers la démo en cas d'erreur critique.
- Données de démo identifiables et réinitialisables sans toucher la production.
- Même contrat métier entre démo et réel.
- Tests de contrat partagés.
- Les fonctionnalités absentes de la démo doivent être annoncées ou simulées uniquement dans un environnement marqué comme démo.

Les variables d'environnement doivent être validées au démarrage : les variables requises manquantes doivent provoquer une erreur explicite, sans exposer leur valeur.

Ne commite jamais `.env`, tokens, certificats, dumps ou sauvegardes.

---

## 13. API, AUTHENTIFICATION ET SÉCURITÉ WEB

Audite toutes les routes, pas uniquement celles de Stories.

Pour chaque route, documente :

- méthode et chemin ;
- authentification ;
- autorisation ;
- validation d'entrée ;
- limites de taille ;
- limitation de débit ;
- idempotence ;
- données retournées ;
- erreurs possibles ;
- journalisation.

Vérifie :

- CSRF selon le modèle de session et les méthodes utilisées ;
- XSS dans les textes, URL, noms et aperçus ;
- validation et normalisation des URL ;
- SSRF si le serveur récupère des URL distantes ;
- upload malveillant ;
- contrôle d'accès objet par objet (IDOR/BOLA) ;
- CORS ;
- cookies `HttpOnly`, `Secure`, `SameSite` ;
- sécurité des en-têtes ;
- rate limiting ;
- protection contre le spam ;
- limites de pagination et payload ;
- permissions d'admin ;
- séparation des rôles ;
- révocation de session.

Chaque identifiant reçu du client doit faire l'objet d'un contrôle d'autorisation sur la ressource correspondante. Le fait qu'un identifiant soit difficile à deviner ne remplace pas l'autorisation.

---

## 14. DÉPENDANCES, CI ET CHAÎNE DE LIVRAISON

### 14.1 Dépendances

- vérifie les dépendances directes et transitives ;
- vérifie le lockfile ;
- identifie les paquets inutilisés ou dupliqués ;
- contrôle les peer dependencies ;
- exécute l'audit de vulnérabilités disponible ;
- contrôle les licences des dépendances ;
- justifie chaque nouvelle dépendance ;
- évite les packages abandonnés lorsque des alternatives maintenues existent.

Ne mets pas à jour tout le projet en une seule fois. Fais les mises à jour par groupes compatibles et teste après chaque groupe.

### 14.2 Node et CI

Vérifie les versions Node dans : `package.json`, lockfile, `.nvmrc`, Dockerfiles, CI et hébergement.

Choisis une version encore maintenue, prise en charge par Next.js, les bibliothèques natives et le fournisseur de déploiement. N'effectue pas une mise à jour majeure sans tests.

La CI doit exécuter au minimum, selon les scripts existants :

1. installation reproductible ;
2. vérification TypeScript ;
3. lint ;
4. tests unitaires ;
5. tests API ;
6. tests d'intégration PostgreSQL et RLS ;
7. tests de contrat du backend démo ;
8. tests UI/Playwright ;
9. contrôles d'accessibilité essentiels ;
10. audit UI ;
11. build de production ;
12. détection de secrets.

Ne désactive pas un test qui échoue pour faire passer la CI. Si un test est flaky, reproduis le problème, corrige sa cause et documente toute mise en quarantaine temporaire.

### 14.3 `.gitignore` et documentation

Vérifie la règle globale `*.md` signalée par le précédent audit. Si elle existe toujours, remplace-la par des exclusions ciblées afin que les documents Markdown voulus soient versionnés.

Ne supprime pas les fichiers déjà présents. Vérifie `git check-ignore -v` sur les documents importants.

Réconcilie `README.md`, `ROADMAP.md`, les fichiers d'environnement et `docs/ops/` avec le fonctionnement réel.

Chaque variable d'environnement doit avoir : nom, usage, côté serveur/client, obligatoire/facultative, environnement requis, exemple non secret et procédure de rotation si sensible.

---

## 15. PLAN D'EXÉCUTION OBLIGATOIRE

Travaille dans cet ordre. Tu peux paralléliser des analyses indépendantes, mais ne parallélise pas des modifications concurrentes sur les mêmes fichiers ou migrations.

### Phase A — Baseline et vérification

- établir l'état Git ;
- lire l'architecture ;
- exécuter les contrôles ;
- vérifier chaque constat précédent ;
- produire le registre ;
- établir les captures de référence.

**Gate A :** aucun changement fonctionnel avant d'avoir compris les parcours et le mode de stockage.

### Phase B — P0 sécurité

- secrets ;
- rôles PostgreSQL et RLS ;
- TLS ;
- sauvegardes ;
- contrôle d'accès API ;
- tests négatifs d'isolation.

Les opérations qui exigent la console externe deviennent des tâches documentées et bloquantes, pas des prétendues corrections.

**Gate B :** aucune faille d'accès inter-utilisateurs connue ; les secrets signalés sont révoqués ou le risque est clairement marqué comme bloquant production.

### Phase C — P1 médias et fiabilité

- architecture d'upload ;
- stockage ;
- traitement média ;
- lecture ;
- cache ;
- expiration et purge ;
- pagination ;
- erreurs et observabilité.

**Gate C :** un utilisateur peut publier, retrouver, lire et supprimer un média dans les limites documentées, sans perte silencieuse et avec les droits corrects.

### Phase D — Correction du lecteur Stories

- machine d'état ;
- progression image/texte/vidéo ;
- pause/reprise ;
- visibilité ;
- gestes ;
- navigation auteur ;
- focus et clavier ;
- erreurs/états vides.

**Gate D :** tests automatisés de chaque comportement, sur le mode de démonstration et le backend réel disponible.

### Phase E — Correction du rail et de la confidentialité

- avatars ;
- état lu/non lu ;
- audience ;
- pagination ;
- permissions ;
- rendu mobile/desktop.

**Gate E :** l'état du rail correspond aux données réellement consultables et aucune story privée n'est exposée.

### Phase F — Refondre l'éditeur par incréments

Ordre recommandé :

1. modèle de composition stable et versionné ;
2. prévisualisation = rendu export ;
3. sélection de média fiable ;
4. texte multi-calques ;
5. transformation et ordre des calques ;
6. stickers et emojis ;
7. dessin ;
8. image et filtres ;
9. vidéo et timeline ;
10. GIF et fournisseurs externes ;
11. sondages/questions/liens/mentions ;
12. musique sous licence ;
13. brouillons, reprise et publication fiable.

N'annonce pas toutes les fonctions comme disponibles tant qu'elles ne sont pas réelles.

**Gate F :** l'aperçu, l'export et le média publié sont cohérents ; les échecs d'upload ne détruisent pas la composition.

### Phase G — UI/UX globale

- système de tokens ;
- typographie ;
- cibles tactiles ;
- thèmes ;
- responsive ;
- accessibilité ;
- modales et menus ;
- feedback ;
- contrôles visuels.

**Gate G :** captures vérifiées sur les breakpoints ciblés et aucune régression majeure.

### Phase H — Refactorisation et documentation

- découpage progressif ;
- réduction des responsabilités ;
- mise à jour des contrats et types ;
- CI ;
- versions runtime ;
- `.gitignore` ;
- README/roadmap/docs ;
- guide de déploiement et de restauration.

**Gate H :** documentation et code décrivent le même système.

### Phase I — Validation finale

Exécute à nouveau toute la suite de contrôles. Compare les résultats avec la baseline. Répare les régressions. Prépare un rapport final précis.

---

## 16. MATRICE DE TESTS MINIMALE

Ajoute ou adapte des tests couvrant au moins les parcours suivants.

### Authentification et permissions

- anonyme / utilisateur A / utilisateur B / propriétaire / administrateur ;
- lecture autorisée et refusée ;
- modification et suppression autorisées et refusées ;
- IDOR sur toutes les routes ;
- accès direct à une clé média ;
- RLS avec différents rôles ;
- session expirée et révoquée.

### Stories et média

- publier texte ;
- publier image ;
- changer image A en image B puis exporter ;
- publier vidéo courte ;
- vidéo plus longue que l'ancienne limite ;
- média corrompu ;
- MIME falsifié ;
- fichier trop lourd ;
- upload interrompu ;
- retry ;
- finalisation répétée ;
- transcodage en échec ;
- lecture avec cache ;
- expiration ;
- purge ;
- suppression manuelle ;
- accès privé refusé.

### Viewer

- progression image ;
- progression texte ;
- durée vidéo réelle ;
- fin vidéo ;
- autoplay refusé ;
- pause appui long sur média enfant ;
- pause et reprise ;
- onglet caché/visible ;
- menu ouvert ;
- tap gauche/droite ;
- swipe vertical/horizontal ;
- navigation entre auteurs ;
- clavier avec focus dans un champ ;
- déplacement sticker par flèches sans avancer la story.

### Composer

- texte multi-blocs ;
- déplacement/rotation/échelle ;
- calques et ordre ;
- dessin/annuler/rétablir ;
- filtres ;
- recadrage ;
- superposition sur vidéo ;
- aperçu comparé à l'export ;
- brouillon ;
- échec réseau sans perte ;
- publication et confirmation ;
- thème clair/sombre ;
- petit écran et clavier mobile.

### UI et accessibilité

- 320 px de largeur ;
- 360 px ;
- 390 px ;
- 430 px ;
- tablette ;
- desktop ;
- zoom ;
- orientation ;
- safe areas ;
- focus clavier ;
- lecteur d'écran sur contrôles principaux ;
- reduced motion ;
- contraste ;
- labels ;
- tailles tactiles ;
- absence de scroll horizontal accidentel.

### Environnements

- backend de démonstration ;
- PostgreSQL de test ;
- staging ;
- navigateurs supportés ;
- stockage média réel de test.

Ne mélange jamais les données de démonstration et les données de production.

---

## 17. CONDITIONS DE « DONE »

Une tâche n'est terminée que si toutes les conditions applicables sont remplies :

1. Le code est intégré dans l'architecture existante.
2. Les validations d'entrée et permissions sont réalisées côté serveur.
3. Les états de chargement, succès, erreur et vide sont traités.
4. Les données persistent lorsqu'elles doivent persister.
5. Le parcours a été testé avec succès.
6. Les tests de régression passent.
7. Les captures UI pertinentes ont été inspectées.
8. Les modes clair/sombre et les breakpoints concernés ont été vérifiés.
9. L'accessibilité de base a été contrôlée.
10. La documentation est à jour.
11. Les limites et dépendances externes sont déclarées.
12. Aucun secret ou contenu personnel n'a été introduit dans Git.

Une compilation réussie ne suffit pas. Une maquette réussie ne suffit pas. Un test unitaire isolé ne suffit pas pour prouver un parcours utilisateur complet.

---

## 18. LIVRABLES ATTENDUS

À la fin de chaque phase, et dans le rapport final, fournis :

1. résumé des travaux ;
2. problèmes confirmés ;
3. problèmes non reproduits ou encore hypothétiques ;
4. fichiers créés ;
5. fichiers modifiés ;
6. migrations ajoutées et leur stratégie de rollback ;
7. variables d'environnement ajoutées/modifiées (noms uniquement, jamais valeurs) ;
8. tests réellement exécutés ;
9. résultats exacts et échecs restants ;
10. captures ou chemins des rapports visuels ;
11. risques et blocages externes ;
12. prochaines tâches prioritaires.

Crée ou mets à jour :

- `docs/engineering/DEVNET_AUDIT_BASELINE.md` ;
- `docs/engineering/DEVNET_REMEDIATION_LEDGER.md` ;
- `docs/engineering/DEVNET_SECURITY_MODEL.md` ;
- `docs/engineering/DEVNET_MEDIA_ARCHITECTURE.md` ;
- `docs/engineering/DEVNET_STORIES_SPEC.md` ;
- `docs/engineering/DEVNET_UI_QA.md` ;
- `docs/engineering/DEVNET_RELEASE_CHECKLIST.md`.

Adapte les emplacements si le dépôt possède déjà une convention documentaire différente. Évite les duplications.

---

## 19. LICENCE MIT ET PROPRIÉTÉ INTELLECTUELLE

- Préserve le fichier `LICENSE` et les notices existantes.
- Les nouveaux codes originaux intégrés au projet suivent la licence MIT du dépôt, sous réserve des contributions et notices applicables.
- Ne copie aucun code propriétaire de WhatsApp, Instagram ou Snapchat.
- Ne récupère aucun logo, police, icône, illustration, son ou asset propriétaire sans autorisation.
- Reproduis des **capacités et comportements génériques**, avec une identité visuelle originale DEVNET.
- Vérifie les licences de toutes les nouvelles dépendances et ressources.
- Ajoute `THIRD_PARTY_NOTICES.md` si des notices tierces doivent être conservées.
- Ne présente jamais le projet comme officiellement affilié à Meta ou Snap.

---

## 20. DIRECTIVE D'EXÉCUTION FINALE

Commence maintenant par la phase A.

**Ne commence pas par générer un énorme composant ni par réécrire l'application.** Inspecte le dépôt actuel et confirme les faits. Crée le baseline et le registre des problèmes. Ensuite, corrige les P0, puis les P1, avant d'investir dans l'éditeur multimédia et les finitions visuelles.

Travaille de manière autonome sur les tâches locales, réversibles et clairement définies. Pour les opérations qui exigent une autorisation externe, un secret, une migration distante, une dépense, un déploiement ou une action destructive, prépare la procédure, indique le risque et attends l'autorisation nécessaire.

À chaque étape :

- modifie un périmètre limité ;
- teste immédiatement ;
- inspecte le diff ;
- vérifie qu'aucun autre parcours n'a régressé ;
- mets à jour le registre ;
- poursuis avec la tâche suivante.

Ne t'arrête pas à un audit ou à un plan. **Implémente réellement les corrections que l'environnement permet d'effectuer en sécurité.**

Ne marque jamais comme « terminé » ce qui n'a pas été testé. Ne masque aucun défaut pour obtenir un rapport vert. Ne prétends pas avoir atteint une parité de 98 % sans matrice de fonctionnalités et preuves de tests.

Le résultat attendu est un DEVNET fiable, sécurisé, maintenable, accessible, cohérent visuellement et doté d'un système Stories réellement abouti — sans sacrifier la stabilité du reste de l'application.
