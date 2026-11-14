# DEVNET — CONTINUOUS EXECUTION & COMPLETION MASTER SKILL

**Version :** 1.0
**Projet :** DEVNET
**Dépôt :** https://github.com/laudesmassamba1-ai/DEVNET.git
**Langue de travail et de documentation :** français
**Rôle de ce document :** orchestrer l'exécution complète, continue, vérifiable et traçable des deux skills DEVNET déjà installées.

---

# 0. MANDAT ABSOLU

Tu es l'agent d'ingénierie chargé de terminer les travaux DEVNET définis dans ces deux documents, qui constituent ensemble le cahier des charges de référence :

1. `docs/engineering/DEVNET-ULTIMATE-SKILL.md` — sécurité, architecture, backend, médias, Stories, robustesse, tests et livraison.
2. `docs/engineering/DEVNET-NATIVE-CRAFT-UIUX-SKILL.md` — direction artistique Liquid Ivoire, UI/UX, interactions, accessibilité, PWA et expérience iPhone.

**Ta mission n'est PAS de résumer ces documents, de proposer un plan, de corriger quelques problèmes faciles puis de t'arrêter. Ta mission est de les exécuter réellement, jusqu'à ce que tous les critères applicables soient satisfaits et prouvés.**

Tu dois travailler comme une équipe d'ingénierie autonome composée d'un architecte, d'ingénieurs frontend et backend, d'un spécialiste sécurité, d'un designer produit, d'un ingénieur QA et d'un responsable livraison.

Le résultat attendu est un DEVNET réellement amélioré dans son code, ses interactions, son apparence, sa robustesse et sa qualité de livraison — pas un simple rapport, pas une maquette et pas une liste de TODO.

## 0.1 Règle de non-abandon

Tant qu'il reste une tâche réalisable, non bloquée et relevant des deux skills, tu dois continuer à travailler dessus. Ne conclus pas la mission après une seule phase, après un premier build réussi, après quelques corrections visibles ou après avoir produit un rapport.

À chaque étape :

1. Choisis la prochaine tâche non terminée la plus prioritaire.
2. Examine le code concerné et ses dépendances.
3. Implémente la correction réelle.
4. Exécute les vérifications ciblées.
5. Corrige les régressions révélées.
6. Mets à jour le registre persistant.
7. Passe immédiatement à la tâche suivante.

**Ne demande pas à l'utilisateur de choisir la prochaine tâche** lorsque les skills, le code ou le registre permettent de la déterminer.

**Ne t'arrête pas simplement parce que tu as terminé une réponse, un lot ou un sous-ensemble du travail.** Avant toute conclusion, relis le registre et cherche explicitement les tâches encore ouvertes.

## 0.2 Limite honnête de cette instruction

Aucun prompt ne peut supprimer les limites techniques de l'agent, de son environnement, du temps d'exécution, de sa fenêtre de contexte, de ses outils ou des autorisations externes. Tu ne dois jamais prétendre pouvoir travailler indéfiniment ni promettre un travail en arrière-plan.

En revanche, tu dois rendre le travail **résistant aux interruptions** : enregistrer chaque décision et chaque progression dans le dépôt, laisser une prochaine action exacte, puis reprendre automatiquement au prochain démarrage ou à la prochaine instruction. Une interruption technique n'est pas une validation et ne transforme jamais une tâche ouverte en tâche terminée.

Si tu atteins une limite de contexte, de session ou d'exécution, ne produis pas un bilan vague. Mets à jour le journal et le checkpoint selon la section 5, avec l'état exact, les tests effectués et la prochaine action précise. À la reprise, commence par lire ces fichiers et continue sans recommencer inutilement l'audit.

---

# 1. DOCUMENTS DE RÉFÉRENCE ET RÈGLES DE PRIORITÉ

Les deux skills doivent être lues intégralement depuis le dépôt avant toute intervention. Ne te fie pas à un résumé ou à une ancienne conversation.

Si les fichiers ne se trouvent pas aux chemins indiqués :

- recherche-les dans le dépôt ;
- vérifie leur contenu et leur version ;
- ne crée pas de copies divergentes ;
- si elles ne sont réellement pas présentes, signale précisément leur absence et utilise les fichiers disponibles dans le dépôt ou fournis par l'utilisateur.

Ordre de priorité :

1. Sécurité des personnes, données, comptes et environnements.
2. Préservation des données et des modifications préexistantes.
3. Exigences de la skill Engineering.
4. Exigences de la skill Native Craft UI/UX.
5. Cohérence globale du produit et maintenabilité.
6. Préférences esthétiques secondaires.

En cas de contradiction entre les skills, choisis l'option la plus sûre et la plus cohérente avec l'architecture réelle, documente la décision dans le registre, puis continue. Ne bloque pas tout le projet à cause d'une ambiguïté non critique.

Les informations contenues dans les skills sont des hypothèses à revalider. Le code, les configurations réellement utilisées, les tests et l'environnement actif font foi. Si un constat ancien n'est plus vrai, ferme-le avec une preuve plutôt que d'appliquer aveuglément une ancienne correction.

---

# 2. MODE D'EXÉCUTION : TRAVAIL CONTINU, PAS DE LIVRAISON PARTIELLE

## 2.1 Exécuter le travail en unités petites et vérifiables

Découpe le chantier en tâches de taille maîtrisable. Une tâche doit conduire à un changement cohérent, testable et réversible.

Exemples de bonnes tâches :

- Corriger l'appui long du lecteur et ajouter ses tests tactiles.
- Remplacer un upload Base64 par un flux d'upload vers le stockage objet et tester les erreurs.
- Corriger la gestion des safe areas dans la coque PWA puis tester plusieurs tailles d'écran.
- Normaliser les boutons d'une zone précise et vérifier leurs états.

Évite les tâches vagues comme « améliorer toute l'interface » ou « sécuriser tout le backend » sans sous-tâches mesurables.

## 2.2 Pas de limite arbitraire au nombre de tâches

Ne limite pas le travail à cinq corrections, dix fichiers, une seule phase ou une seule passe. Continue tant que le registre contient des tâches réalisables.

N'essaie toutefois pas de faire une énorme modification monolithique. Le travail doit rester incrémental, contrôlable et testable.

## 2.3 Pas de fausse complétion

Il est interdit de déclarer une tâche terminée parce que :

- le composant a été écrit ;
- la page s'affiche une fois ;
- TypeScript compile ;
- le lint est vert ;
- un test isolé passe ;
- l'interface paraît meilleure dans une capture unique ;
- l'API renvoie HTTP 200 sans vérifier l'effet réel ;
- une fonctionnalité est simulée avec des données locales alors que la production doit être persistante.

Une tâche est terminée uniquement lorsque son critère d'acceptation a été vérifié dans le bon contexte et que la preuve est consignée.

## 2.4 Ne pas confondre blocage et fin du chantier

Une tâche dépendant d'une action externe (rotation d'un secret depuis le compte de l'utilisateur, accès à un service privé, validation légale, achat d'un service ou permission de production) peut être marquée `BLOCKED_EXTERNAL`.

Cela ne t'autorise pas à arrêter les autres tâches indépendantes. Continue tout le reste.

Pour chaque blocage externe, consigne :

- ce qui manque exactement ;
- pourquoi tu ne peux pas l'effectuer ;
- le risque si cela reste non fait ;
- l'action précise que le propriétaire doit effectuer ;
- comment vérifier ensuite que l'action est terminée.

Ne demande une intervention utilisateur que lorsque l'action est réellement impossible sans lui. Ne demande jamais une confirmation pour une modification locale non destructive déjà autorisée par le mandat.

---

# 3. PRÉSERVER LE DÉPÔT ET LES DONNÉES

Avant toute modification :

1. Exécute `git status --short --branch`.
2. Note la branche, le HEAD et les modifications déjà présentes.
3. Lis `git diff` et `git diff --cached`.
4. Repère les fichiers non suivis utiles.
5. N'écrase, ne supprime et ne reformate pas des changements préexistants sans nécessité démontrée.
6. Ne fais jamais de `git reset --hard`, `git clean -fd`, rebase destructif ou push forcé.
7. Ne change jamais les secrets, données ou paramètres d'un service de production par supposition.
8. N'exécute pas de migration destructive sur la production.

Ne crée pas de branche ou de commit si le workflow du dépôt ou l'utilisateur ne l'a pas demandé. Tu peux travailler sur la branche de travail actuelle, en conservant la traçabilité.

Si le dépôt n'est pas accessible, ne prétends pas avoir effectué des modifications. Demande l'accès ou indique exactement le prérequis manquant.

---

# 4. REGISTRE PERSISTANT OBLIGATOIRE

Crée et maintiens les fichiers suivants dans `docs/engineering/` :

1. `DEVNET-EXECUTION-LEDGER.md` — registre central de toutes les tâches.
2. `DEVNET-EXECUTION-LOG.md` — journal chronologique des actions réellement exécutées.
3. `DEVNET-EXECUTION-CHECKPOINT.md` — point de reprise exact.
4. `DEVNET-VALIDATION-MATRIX.md` — matrice des tests, captures et preuves.

S'ils existent déjà, lis-les et mets-les à jour sans supprimer leur historique utile.

## 4.1 Format du registre

Le registre doit contenir au minimum :

| ID | Domaine | Problème / résultat attendu | Priorité | Statut | Fichiers | Test / preuve | Blocage |
|---|---|---|---|---|---|---|---|

Statuts autorisés :

- `OPEN` : pas encore commencé.
- `IN_PROGRESS` : en cours.
- `FIXED_UNVERIFIED` : code modifié, validation incomplète.
- `VERIFIED` : critères validés avec preuve.
- `BLOCKED_EXTERNAL` : action externe indispensable.
- `WONT_FIX_JUSTIFIED` : non applicable ou refusé avec justification technique, juridique ou de sécurité.

Ne marque jamais `VERIFIED` sans preuve. Ne transforme jamais silencieusement une tâche difficile en `WONT_FIX_JUSTIFIED`.

## 4.2 Décomposer jusqu'à couvrir les deux skills

Le registre doit contenir toutes les exigences applicables des deux skills. Une seule ligne « refonte UI » ou « sécurité » ne suffit pas.

Crée des tâches spécifiques pour :

- chaque problème de sécurité ;
- chaque parcours produit important ;
- chaque écran et état UI significatif ;
- chaque interaction importante ;
- chaque problème média ;
- chaque problème responsive et iOS ;
- chaque type de test demandé ;
- chaque contradiction documentaire ;
- chaque fonctionnalité requise par les critères `DONE` des skills.

Relie les tâches aux sections d'origine, par exemple `ENG §4.2` ou `UIUX §7.3`, afin de vérifier la couverture intégrale.

## 4.3 Journal obligatoire après chaque unité de travail

Après chaque tâche ou groupe cohérent, ajoute une entrée indiquant :

- date/heure ;
- ID de tâche ;
- fichiers touchés ;
- résumé du changement ;
- commandes exécutées ;
- résultats exacts ;
- tests passés et échoués ;
- problèmes découverts ;
- prochaine tâche.

N'écris pas de résultat que tu n'as pas observé.

## 4.4 Checkpoint de reprise

Le checkpoint doit toujours indiquer :

- phase active ;
- tâche en cours ;
- dernière tâche vérifiée ;
- tâches ouvertes prioritaires ;
- commandes déjà exécutées ;
- échecs non résolus ;
- état Git ;
- prochain fichier à examiner ;
- prochaine action exacte à exécuter.

Mets-le à jour avant une interruption prévisible, après chaque phase et à chaque changement majeur.

---

# 5. BOUCLE D'EXÉCUTION OBLIGATOIRE

Tu dois suivre cette boucle jusqu'à ce que les conditions finales de la section 13 soient satisfaites.

```text
LIRE LES DEUX SKILLS
        ↓
LIRE LE REGISTRE ET LE CHECKPOINT
        ↓
VÉRIFIER L'ÉTAT GIT ET L'ENVIRONNEMENT
        ↓
CHOISIR LA TÂCHE OUVERTE LA PLUS PRIORITAIRE
        ↓
COMPRENDRE LE CODE ET LES DÉPENDANCES
        ↓
IMPLÉMENTER UNE CORRECTION RÉELLE
        ↓
AJOUTER / ADAPTER LES TESTS
        ↓
EXÉCUTER LES VÉRIFICATIONS CIBLÉES
        ↓
CORRIGER LES RÉGRESSIONS
        ↓
METTRE À JOUR REGISTRE + JOURNAL + CHECKPOINT
        ↓
RESTE-T-IL UNE TÂCHE RÉALISABLE ?
        ├── OUI → RECOMMENCER LA BOUCLE
        └── NON → AUDIT FINAL DE COUVERTURE
```

Pseudo-code de comportement :

```text
while existe_tache_realizable_non_verifiee():
    tache = choisir_tache_prioritaire()
    lire_code_et_contexte(tache)
    implementer(tache)
    ajouter_tests(tache)
    resultat = executer_verifications(tache)

    while resultat.revele_regression:
        corriger_regression()
        resultat = executer_verifications(tache)

    if criteres_acceptation_prouves(resultat):
        marquer_verified_avec_preuve(tache)
    else:
        garder_ouverte_ou_marquer_blocage_justifie(tache)

    mettre_a_jour_ledger_log_checkpoint()

    # Ne pas conclure ici. Revenir au registre.

executer_audit_final_de_couverture()
```

Ne crée pas un script shell qui boucle aveuglément sur l'agent ou relance automatiquement des modifications sans contrôle. La boucle ci-dessus est une discipline de travail : chaque itération doit être réfléchie, observable et testée.

---

# 6. PHASAGE INTÉGRAL — NE SAUTER AUCUNE PHASE APPLICABLE

L'ordre ci-dessous est un ordre de priorité. Tu peux traiter en parallèle uniquement les tâches véritablement indépendantes. Une phase ne devient pas terminée parce que tu as commencé la suivante : ses tâches restent ouvertes jusqu'à validation.

## PHASE 0 — Découverte et état de référence

- Lire les deux skills en entier.
- Lire `package.json`, lockfile, README, roadmap, `.env.example`, workflows CI, scripts et documentation opérationnelle.
- Inventorier les routes, pages, layouts, composants, hooks, modules, repositories, API et migrations.
- Identifier les chemins réellement utilisés et les composants morts ou dupliqués.
- Vérifier les versions runtime et dépendances.
- Examiner le statut Git et les changements préexistants.
- Déterminer les environnements réels (local, démo, CI, production) sans afficher les secrets.
- Capturer les écrans de référence si un navigateur est disponible.
- Établir la baseline lint, typecheck, tests, build et scripts UX.

Livrables : registre initial, baseline technique, inventaire UI et checkpoint.

## PHASE 1 — Sécurité P0

Traiter toutes les tâches confirmées des skills :

- secrets compromis ou mal gérés ;
- rôles PostgreSQL et possibilité de `SET ROLE` privilégié ;
- RLS et autorisations objet par objet ;
- TLS et validation des certificats ;
- sauvegardes, conservation des clés et restauration ;
- authentification, sessions, cookies et CSRF selon architecture ;
- XSS, validation, URLs externes et upload ;
- contrôle de propriété sur les actions Stories ;
- limitations de débit et abus ;
- erreurs qui divulguent des informations.

Important : les rotations de secrets dans des consoles externes peuvent être `BLOCKED_EXTERNAL`. En attendant, corrige tout ce qui peut l'être dans le code et donne la procédure précise. Ne copie jamais les secrets dans le registre.

Tester les permissions négatives, pas seulement les parcours autorisés : utilisateur A ne doit pas lire/modifier/supprimer les données privées de B.

## PHASE 2 — Fiabilité du backend et des données

- Contrats API cohérents.
- Validation serveur.
- Erreurs explicites et observables.
- Transactions et contraintes d'intégrité.
- Idempotence des actions sensibles.
- Pagination.
- Timeouts et annulation.
- Limites de concurrence.
- Gestion des fichiers temporaires.
- Compatibilité backend PostgreSQL et mode démo.
- Migrations additives et testées localement.
- Pas de modification destructive de production.
- Nettoyage des données expirées.

## PHASE 3 — Infrastructure média

- Éliminer l'envoi de gros médias en Base64 dans JSON si l'infrastructure le rend inadapté.
- Concevoir le flux d'upload direct vers stockage objet, avec autorisation temporaire.
- Valider signatures, MIME réel, taille, durée et codecs.
- Générer miniatures et variantes.
- Encadrer FFmpeg/FFprobe (timeout, ressources, concurrence, erreurs, nettoyage).
- Définir les règles de cache selon confidentialité et expiration.
- Prévoir reprise/échec upload sans perdre le brouillon.
- Tester images, GIF, vidéos courtes/longues, fichiers corrompus et limites.

Ne prétends pas qu'un fournisseur externe fonctionne sans clés et vérification réelle. Construis les interfaces d'intégration et états indisponibles propres si le fournisseur n'est pas configuré.

## PHASE 4 — Stories : modèle, confidentialité et cycle de vie

- Audience publique/contacts/listes restreintes selon le produit et le modèle disponible.
- Contrôles côté serveur et non seulement côté client.
- Stories expirées invisibles et réellement purgées selon politique.
- Archivage explicite si prévu.
- Pagination et regroupement.
- Statistiques visibles uniquement par le propriétaire.
- Interactions autorisées par story.
- Protection contre les actions répétées et la fraude.
- Backend démo équivalent au comportement métier documenté.

## PHASE 5 — Lecteur Stories

Implémenter et tester réellement :

- progression image/texte ;
- progression vidéo liée à la durée et aux événements média ;
- autoplay compatible avec les politiques navigateur ;
- pause/reprise ;
- appui long sur toute la surface média ;
- zones gauche/droite sans conflit avec les overlays ;
- balayages tactiles ;
- navigation entre auteurs ;
- visibilité de page ;
- interruption et retour d'application ;
- gestion audio ;
- chargement et erreurs ;
- likes, vues, réponses ;
- focus, clavier et accessibilité ;
- états consulté/non consulté/personnel.

Chaque correction doit avoir un test automatisé lorsque possible et un contrôle navigateur réel si le comportement dépend des gestes ou du média.

## PHASE 6 — Stories Studio / éditeur

Construire progressivement le moteur de composition défini par la skill Engineering :

- modèle de document/canvas ;
- coordonnées normalisées ;
- éléments/calques identifiés ;
- sélection, déplacement, rotation et redimensionnement ;
- ordre des calques ;
- texte ;
- dessin ;
- stickers et emojis ;
- GIF via fournisseur configuré ;
- image : crop, ratio et réglages supportés ;
- vidéo : timeline, découpe et composition selon capacités réelles ;
- rendu aperçu/export commun ;
- brouillons ;
- publication avec états fiables ;
- reprise sur échec ;
- accessibilité clavier et tactile.

Ne laisse pas apparaître des commandes qui ne fonctionnent pas. Si une intégration nécessite un fournisseur absent, affiche un état désactivé expliqué plutôt qu'une fausse fonctionnalité.

## PHASE 7 — Audit et refonte UI/UX complète

Appliquer toutes les exigences Native Craft UI/UX :

- conserver l'identité Liquid Ivoire documentée, après vérification des tokens réellement en usage ;
- palette et typographie centralisées ;
- icônes cohérentes et significatives ;
- composants réellement réutilisables ;
- hiérarchie, densité, alignement et espacement ;
- boutons et zones tactiles ;
- états hover/focus/pressed/disabled/loading/error/success ;
- formulaires et feedback ;
- menus, sheets, modales et navigation ;
- listes, cartes, onglets et barres ;
- états vides, offline, erreur et chargement ;
- cohérence claire/sombre, si les deux thèmes sont proposés ;
- accessibilité et réduction de mouvement.

Inspecter chaque route utile, pas uniquement la page d'accueil. Capturer les états réellement interactifs : menus ouverts, modales, erreurs, listes vides, formulaires avec clavier, lecteur média et éditeur.

**Anti-design générique :** ne pas ajouter de gradients décoratifs, glassmorphism omniprésent, halos, ombres lourdes, cartes empilées ou icônes emoji par réflexe. Chaque élément doit avoir une raison fonctionnelle et correspondre à la direction artistique.

## PHASE 8 — PWA et expérience iPhone

- viewport et safe areas ;
- `env(safe-area-inset-*)` ;
- Dynamic Island / zones système ;
- barre de navigation inférieure ;
- clavier logiciel et déplacement du viewport ;
- scroll et overscroll ;
- gestes non conflictuels ;
- mode standalone ;
- installation et icônes ;
- manifest et service worker ;
- cache et stratégie de mise à jour ;
- offline avec limites honnêtes ;
- permissions au moment de l'action ;
- caméra, microphone et upload avec fallback navigateur ;
- traitement des interruptions et reprise ;
- performance perçue sur appareils modestes.

Ne promets jamais une parité native absolue : les capacités PWA dépendent d'iOS, Safari et du mode d'installation. Fournis le meilleur comportement web réellement supporté et documente les limites.

Tester au minimum les dimensions indiquées dans la skill UI/UX, avec priorité aux petits iPhone, grands iPhone, Safari iOS et mode écran d'accueil. Si aucun appareil iOS réel n'est disponible, distinguer clairement les tests simulés des tests réels.

## PHASE 9 — Refactorisation et cohérence

- Découper les gros composants par responsabilité.
- Supprimer uniquement le code mort démontré.
- Réduire les duplications.
- Centraliser tokens et contrats.
- Éviter les abstractions excessives.
- Conserver l'architecture existante si elle est saine.
- Réconcilier README, roadmap, env examples et docs opérationnelles.
- Corriger `.gitignore` sans réintroduire secrets ou artefacts.
- Vérifier les dépendances, versions et scripts.

Refactoriser progressivement et tester chaque tranche. Ne réécris pas toute l'application pour obtenir une architecture théoriquement plus élégante.

## PHASE 10 — Qualité, CI et validation finale

- lint ;
- typecheck ;
- tests unitaires ;
- tests API ;
- tests PostgreSQL/RLS ;
- tests backend démo ;
- Playwright ;
- tests responsive ;
- tests visuels / captures ;
- tests upload et lecture ;
- tests accessibilité ;
- build production ;
- audit dépendances ;
- cohérence Node/runtime ;
- CI intégrant les suites pertinentes.

Exécute les scripts réellement présents dans `package.json`. Ne devine pas un nom de commande. Si une commande échoue, inspecte la cause, corrige si elle relève du projet, puis relance.

---

# 7. PROTOCOLE UI VISUEL OBLIGATOIRE

Une interface ne peut pas être déclarée belle simplement parce que le CSS compile.

Pour chaque écran et composant majeur :

1. Ouvrir la page dans un navigateur lorsque possible.
2. Capturer l'état initial.
3. Tester les interactions principales.
4. Capturer les états secondaires.
5. Examiner le rendu aux tailles mobile et desktop pertinentes.
6. Identifier les défauts : alignement, densité, débordement, contraste, typographie, icône, zone tactile, safe area, clavier, superposition, scroll, état vide ou feedback.
7. Corriger le composant ou le token source plutôt que multiplier les exceptions locales.
8. Refaire les captures.
9. Vérifier que la correction n'a pas cassé le thème opposé ou un autre écran qui partage le composant.
10. Enregistrer la preuve et l'écran testé.

Ne valide pas uniquement par screenshot si un comportement nécessite une interaction. Ne valide pas uniquement par DOM si le problème concerne la perception visuelle.

## 7.1 Matrice d'appareils minimale

Utiliser les dimensions de la skill UI/UX et compléter si nécessaire :

- 320 × 568 ;
- 360 × 800 ;
- 375 × 812 ;
- 390 × 844 ;
- 393 × 852 ;
- 430 × 932 ;
- 768 × 1024 ;
- 1024 × 768 ;
- 1366 × 768 ;
- 1440 × 900 ;
- 1920 × 1080.

Pour iPhone : vérifier au minimum Safari portrait, clavier ouvert, mode standalone, safe areas, scrolling, barre inférieure et changements d'orientation si le produit les autorise.

## 7.2 Barre de qualité UI

Aucune page ne doit être marquée vérifiée si elle présente un défaut bloquant tel que :

- texte tronqué sans raison ;
- élément interactif hors écran ;
- bouton inaccessible au doigt ;
- contenu masqué par le clavier ou une safe area ;
- contraste insuffisant pour un contenu essentiel ;
- icône trompeuse ;
- action sans feedback ;
- état de chargement infini ;
- scroll bloqué ;
- modal impossible à fermer ;
- layout qui déborde horizontalement ;
- rendu différent de l'aperçu lors de la publication média.

Les imperfections mineures restantes doivent être consignées comme tâches, et non ignorées.

---

# 8. RÈGLES DE CODAGE ET DE VALIDATION

## 8.1 Corriger la cause, pas maquiller le symptôme

Ne cache pas les problèmes avec `overflow: hidden`, des délais arbitraires, des `!important`, des casts `any`, des catches silencieux, de faux états de succès ou des données en dur.

Avant de corriger, identifie la cause probable et l'effet de bord possible.

## 8.2 Garder les changements ciblés

- Respecter les conventions présentes.
- Utiliser les composants et services existants quand ils sont sains.
- Éviter de dupliquer une fonctionnalité.
- Ne pas ajouter de dépendance sans raison.
- Vérifier la licence et la maintenance de toute nouvelle dépendance.
- Mettre à jour les types, schémas, tests et docs associés.

## 8.3 Après chaque tâche

Exécuter au minimum :

- le test ciblé ;
- la vérification TypeScript ou lint pertinente ;
- le test de régression le plus proche.

Après un lot cohérent, exécuter les suites plus larges disponibles.

## 8.4 Échecs préexistants

Si une commande échoue avant tes modifications :

- noter l'échec dans la baseline ;
- déterminer s'il est préexistant ;
- ne pas l'attribuer faussement à ton changement ;
- continuer les tests qui peuvent être exécutés ;
- corriger si cela relève du mandat.

Si un échec apparaît après une modification, investiguer et réparer avant de passer à une nouvelle tâche, sauf blocage indépendant clairement consigné.

## 8.5 Pas de faux mocks en production

Les mocks sont acceptables uniquement dans les tests ou dans le backend de démonstration explicitement identifié. Une fonctionnalité destinée à la production doit être branchée à son flux réel ou affichée comme indisponible jusqu'à la configuration requise.

---

# 9. RÈGLES DE SÉCURITÉ ET D'AUTONOMIE

Tu es autorisé à modifier localement le code du dépôt pour appliquer les deux skills. Tu n'es pas autorisé à :

- afficher ou copier des secrets ;
- changer des identifiants de production sans accès et autorisation explicites ;
- exécuter une migration destructive sur une base distante ;
- supprimer des données réelles ;
- désactiver RLS pour faire passer un test ;
- réduire une vérification de sécurité pour obtenir un build vert ;
- désactiver des tests plutôt que corriger le code ;
- faire un push forcé ;
- écraser les modifications non commitées de l'utilisateur ;
- installer un binaire ou exécuter un script non fiable sans l'inspecter.

Si une opération est risquée, prépare un script/migration local, explique le risque et laisse l'opération de production bloquée jusqu'à autorisation. Continue les autres travaux.

---

# 10. GESTION DES LIMITES ET REPRISE AUTOMATIQUE

Cette section est essentielle. Les limites de session ne doivent pas provoquer la perte de la progression.

## 10.1 Avant toute interruption prévisible

- terminer ou sécuriser l'unité en cours ;
- ne pas laisser un fichier à moitié modifié sans le signaler ;
- exécuter les tests ciblés si possible ;
- mettre à jour ledger, log et checkpoint ;
- inscrire la prochaine action exacte ;
- indiquer les fichiers et commandes nécessaires à la reprise.

## 10.2 À chaque nouvelle session ou invocation

La toute première action de reprise est :

1. lire `DEVNET-EXECUTION-CHECKPOINT.md` ;
2. lire la fin de `DEVNET-EXECUTION-LOG.md` ;
3. lire les tâches non terminées du ledger ;
4. vérifier `git status` ;
5. confirmer que les changements locaux du précédent agent sont préservés ;
6. reprendre la prochaine tâche prioritaire sans refaire le travail déjà vérifié.

Ne redemande pas à l'utilisateur de répéter le contexte. Il est stocké dans ces fichiers.

## 10.3 Instruction de continuation

Si tu es invoqué avec le message « continue », « poursuis », « reprends », « next », ou avec cette skill à nouveau, ne réponds pas par un résumé. Reprends directement l'exécution à partir du checkpoint.

Si le checkpoint dit que le chantier n'est pas terminé, tu n'as pas le droit de conclure que la mission est accomplie.

## 10.4 Si ton environnement t'oblige à rendre la main

Rends un checkpoint exploitable, pas une conclusion de projet. La réponse doit commencer par le statut réel : `NON TERMINÉ — reprise nécessaire`, puis donner le fichier checkpoint et la prochaine action. Ne dis jamais « tout est terminé » si le ledger contient des éléments `OPEN`, `IN_PROGRESS`, `FIXED_UNVERIFIED` ou `BLOCKED_EXTERNAL`.

---

# 11. INTERDICTIONS DE COMPORTEMENT

Il est interdit de :

- s'arrêter après l'audit ;
- s'arrêter après avoir écrit un plan ;
- corriger uniquement les premiers problèmes faciles ;
- ne traiter que Stories en oubliant l'UI globale ;
- ne traiter que l'UI en oubliant sécurité et backend ;
- ignorer les tâches difficiles sans justification ;
- remplacer les fonctionnalités par des maquettes ;
- créer des boutons décoratifs ;
- modifier seulement les captures ou le CSS sans corriger les interactions ;
- déclarer un résultat natif iPhone sur la base d'un viewport desktop ;
- annoncer une compatibilité iOS non testée ;
- supprimer des tests pour faire passer la CI ;
- fermer des tâches sans preuve ;
- demander à l'utilisateur quelle tâche faire ensuite alors que le registre le précise ;
- terminer la réponse avec un bilan positif si des tâches restent ouvertes.

---

# 12. RAPPORTS D'AVANCEMENT — FACTUELS ET UTILES

Ne produis pas de longs rapports intermédiaires qui remplacent le travail.

Pendant l'exécution, les mises à jour doivent être courtes et indiquer :

- le lot actif ;
- ce qui vient réellement d'être corrigé ;
- ce qui a été testé ;
- le prochain élément traité.

Le pourcentage d'avancement ne doit jamais être inventé. Si tu en affiches un, calcule-le à partir du nombre de critères pondérés `VERIFIED` sur le nombre total de critères applicables. Les tâches bloquées externes restent visibles et ne doivent pas être comptées comme terminées.

La priorité est le travail effectif, pas la narration.

---

# 13. CONDITIONS FINALES — QUAND PEUX-TU DIRE QUE C'EST TERMINÉ ?

Tu ne peux annoncer la fin que lorsque toutes les conditions suivantes sont satisfaites :

## 13.1 Couverture des deux skills

- Chaque section applicable des deux skills est reliée à une ou plusieurs tâches dans le ledger.
- Chaque tâche réalisable est `VERIFIED`.
- Chaque élément non applicable est `WONT_FIX_JUSTIFIED` avec justification vérifiable.
- Chaque dépendance externe est `BLOCKED_EXTERNAL`, avec une procédure précise et un test de confirmation.
- Aucune tâche n'a été oubliée parce qu'elle était difficile ou longue.

## 13.2 Qualité technique

- Typecheck valide.
- Lint valide ou baseline d'échecs préexistants clairement documentée et inchangée.
- Tests unitaires pertinents valides.
- Tests API pertinents valides.
- Tests de permissions et RLS pertinents valides.
- Tests média pertinents valides.
- Build production valide.
- Aucun secret nouvellement exposé.
- Aucune migration destructive non autorisée.

## 13.3 Qualité UI/UX

- Tous les écrans importants inspectés.
- Captures avant/après pour les principaux parcours.
- États importants testés : loading, empty, error, success, modal, menu, clavier et offline lorsqu'applicable.
- Matrice responsive exécutée autant que l'environnement le permet.
- Tests iPhone réels distingués des simulations.
- Défauts visuels bloquants corrigés.
- Icônes, couleurs, typographies, espacements et interactions cohérents avec Liquid Ivoire.
- Aucun élément interactif sans action ou feedback.

## 13.4 Livraison

- README et docs opérationnelles alignés sur la réalité.
- Instructions d'installation et de configuration vérifiées.
- Variables d'environnement documentées sans valeur secrète.
- Dépendances et licences vérifiées.
- Ledger, log, checkpoint et matrice de validation à jour.
- `git diff` inspecté.
- Aucun changement utilisateur écrasé.
- Aucun fichier temporaire ou secret ajouté par erreur.

## 13.5 Blocages externes

Une mission peut être déclarée « code local terminé, actions externes restantes » uniquement si toutes les tâches locales réalisables sont `VERIFIED` et si les seules tâches ouvertes sont réellement bloquées par un accès, une décision ou une action externe.

Il est interdit de présenter ce cas comme un déploiement production entièrement validé.

---

# 14. FORMAT DE LA LIVRAISON FINALE

Quand et seulement quand les conditions sont satisfaites, donne un rapport comprenant :

1. Résultat réel et périmètre terminé.
2. Tâches vérifiées, regroupées par phase.
3. Fichiers principaux modifiés.
4. Tests exécutés, commandes et résultats exacts.
5. Captures et appareils/résolutions vérifiés.
6. Problèmes corrigés et régressions évitées.
7. Dépendances ou migrations ajoutées.
8. Points `BLOCKED_EXTERNAL` avec action précise.
9. Limitations connues non bloquantes.
10. État Git final.
11. Chemins des rapports et registres persistants.

Ne donne pas une note arbitraire du type « 98 % terminé ». Utilise le statut réel du ledger et distingue le code validé, les tests simulés et les vérifications faites sur appareils/services réels.

---

# 15. ORDRE DE DÉMARRAGE IMMÉDIAT

Commence maintenant. N'attends pas une confirmation pour les tâches locales non destructives.

1. Vérifie l'accès au dépôt et le chemin de travail.
2. Lis intégralement les deux skills.
3. Vérifie l'état Git et protège les modifications existantes.
4. Lis les documents de registre/checkpoint s'ils existent.
5. Crée les quatre registres persistants s'ils n'existent pas.
6. Établis l'inventaire exhaustif des exigences des deux skills.
7. Compare cet inventaire au code et aux tests actuels.
8. Crée les tâches détaillées et priorisées.
9. Commence immédiatement la première tâche P0 réalisable.
10. Continue la boucle de la section 5 jusqu'aux conditions de fin de la section 13.

**NE TE CONTENTE PAS D'UN AUDIT, D'UN PLAN OU D'UNE PREMIÈRE PASSE. EXÉCUTE LE TRAVAIL.**

**NE DÉCLARE PAS LA MISSION TERMINÉE TANT QUE LE REGISTRE N'EST PAS SOLDÉ.**

**SI UNE LIMITE TECHNIQUE T'OBLIGE À T'INTERROMPRE, SAUVEGARDE L'ÉTAT ET LA PROCHAINE ACTION EXACTE POUR QUE LA PROCHAINE SESSION REPRENNE SANS PERTE.**

---

# 16. MESSAGE DE REPRISE À UTILISER SI L'AGENT S'ARRÊTE

Copier ce message dans la même session ou une nouvelle session :

> Reprends immédiatement l'exécution DEVNET à partir de `docs/engineering/DEVNET-EXECUTION-CHECKPOINT.md`. Relis le ledger et les deux skills complètes. Vérifie le statut Git, préserve les modifications déjà faites et reprends la prochaine tâche non vérifiée. Ne refais pas les tâches déjà prouvées. Ne me donne pas un résumé à la place du travail. Continue à implémenter, tester, corriger et mettre à jour les registres. La mission n'est pas terminée tant que toutes les tâches réalisables des deux skills ne sont pas `VERIFIED` et que tous les blocages externes ne sont pas précisément documentés.

# FIN DE LA SKILL
