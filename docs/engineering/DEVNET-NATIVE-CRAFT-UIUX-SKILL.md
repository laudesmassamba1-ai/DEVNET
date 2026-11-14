# DEVNET — NATIVE CRAFT UI/UX SKILL
## Direction artistique, interface, interactions et PWA iPhone de qualité native

**Dépôt :** https://github.com/laudesmassamba1-ai/DEVNET
**Produit :** DEVNET — réseau social pour développeurs
**Mission :** auditer, harmoniser et élever l'expérience visuelle et interactive de DEVNET pour obtenir une application web progressive (PWA) élégante, compacte, rapide, cohérente et agréable à utiliser, avec une sensation proche d'une application native sur iPhone, Android, tablette et desktop.

---

# 0. MANDAT — CE QUE TU DOIS LIVRER

Tu ne dois pas simplement « moderniser le CSS », changer quelques couleurs ou ajouter des animations. Tu dois comprendre l'interface existante, examiner chaque écran et chaque état, identifier les défauts visuels et ergonomiques, puis corriger réellement le produit.

Le résultat doit être :

- **Beau sans être tape-à-l'œil.** Une esthétique éditoriale, soignée et reconnaissable, pas un assemblage de tendances visuelles.
- **Dense sans être étouffant.** Une interface compacte qui utilise efficacement l'espace disponible, sans réduire les textes ou les zones tactiles au point de nuire à la lisibilité.
- **Native dans le ressenti, web dans l'honnêteté.** Navigation fluide, zones sûres iPhone respectées, clavier bien géré, gestes précis, installation PWA propre et performances solides. Ne prétends jamais qu'une PWA possède des capacités natives qu'elle n'a pas.
- **Cohérente.** Une même logique de couleur, de typographie, d'icônes, d'espacement, de rayons, d'élévation, de feedback et de navigation sur toutes les routes.
- **Rapide.** Aucune animation décorative lourde, aucun flou coûteux répété, aucune liste qui charge inutilement toutes les images ou vidéos.
- **Accessible.** Les contrôles restent lisibles, utilisables au clavier, au toucher et avec les technologies d'assistance.
- **Authentiquement DEVNET.** Ne transforme pas DEVNET en clone d'Instagram, de WhatsApp, de Snapchat, d'Apple ou d'un template SaaS acheté.

Tu dois travailler dans le dépôt et modifier les vrais composants. Une maquette isolée, une page de démonstration ou un rapport sans corrections ne constituent pas une livraison.

## Règle de vérité

Ne prétends jamais qu'un écran est « magnifique », « native », « responsive » ou « testé sur iPhone » sans preuve. Chaque affirmation doit être reliée à une capture, un parcours testé, une mesure ou une inspection identifiable.

N'invente pas des bugs. Reproduis-les, documente la preuve et classe-les comme :

- Confirmé : reproduit ou directement démontré par le code.
- Probable : mécanisme problématique identifié, mais reproduction encore nécessaire.
- À vérifier : nécessite un appareil, un compte, une API ou un environnement indisponible.

---

# 1. CONTEXTE DU DÉPÔT — À REVALIDER AVANT DE TOUCHER AU DESIGN

Le README public décrit notamment :

- Next.js 16 App Router et TypeScript strict.
- Tailwind CSS v4, tokens CSS-first via `@theme`.
- Backend applicatif via une gateway interne et des adaptateurs PostgreSQL, avec état de migration à revalider.
- PWA installable sur Android, iOS et desktop.
- Service worker `public/sw.js`, cache de ressources statiques et pages publiques, sans mise en cache des réponses API ni des pages authentifiées.
- Écran hors-ligne `public/offline.html`.
- Police et composants décrits dans la documentation, mais avec des déclarations à réconcilier.
- Direction artistique déclarée « Liquid Ivoire ».

La description de la direction artistique dans le README est la référence de marque à protéger jusqu'à décision contraire :

- Fond ivoire mat, dégradé vertical très discret, sans halo décoratif.
- Accent olive `#C5D58C` pour les actions, avec encre graphite.
- Couleurs sémantiques rares et réservées à leur signification.
- Pas de dégradé Instagram ni de palette néon.
- Verre clair réservé aux surfaces flottantes ou à des usages mesurés ; cartes de contenu traitées avec retenue.
- Typographie documentée : Inter pour le texte et IBM Plex Mono pour les données/code dans la description de la DA.
- Icônes Lucide cohérentes.
- Interface dense, structurée, avec héritage visuel terminal/outil de développement.

**Attention :** le README contient aussi une déclaration de polices `Fraunces`, `Space Grotesk` et `JetBrains Mono`. Ne choisis pas arbitrairement l'une ou l'autre liste. Inspecte les imports `next/font`, les variables CSS, le rendu réel, les composants et l'historique récent. Décide d'une seule hiérarchie typographique cohérente, documente la décision et corrige les documents contradictoires.

Le README mentionne aussi une navigation avec onglets en haut et une barre d'état en bas. N'applique pas cette convention aveuglément à l'iPhone. Étudie les parcours réels et propose une adaptation mobile naturelle, sans détruire la logique desktop ni les repères de la marque.

**La documentation ne remplace jamais le code réellement exécuté.** Identifie les composants actifs, les routes, les layouts, les thèmes, les feuilles de style, les manifestes, le service worker et les écrans effectivement rendus avant de prendre une décision.

---

# 2. PHASE ZÉRO — INVENTAIRE ET BASELINE VISUELLE

Avant toute modification :

1. Lire les instructions du dépôt (`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, README, skill engineering déjà ajoutée, scripts et architecture).
2. Vérifier `git status`, la branche, les modifications locales et les derniers commits. Ne jamais écraser le travail préexistant.
3. Identifier toutes les routes publiques, privées, dynamiques, pages d'authentification, overlays et parcours PWA.
4. Identifier le layout racine, les layouts imbriqués, la navigation, les composants de page, les composants partagés, les tokens CSS et les fontes effectivement chargées.
5. Trouver le système d'icônes réellement utilisé et recenser les icônes non uniformes, emoji utilisés comme icônes, SVG custom redondants et icônes sans label.
6. Identifier les composants dupliqués ou concurrents et distinguer ceux qui sont utilisés de ceux qui sont morts.
7. Lire les scripts existants de scan UX, lint UI, Playwright, PWA et capture d'écran. Ne pas supposer qu'un scanner statique couvre le rendu réel.
8. Lancer l'application localement selon les instructions réelles du dépôt.
9. Générer une baseline de captures de tous les écrans clés, sans changer le code.
10. Reproduire les parcours principaux au clavier, à la souris et au toucher simulé.

Créer `docs/uiux/BASELINE.md` avec :

- Routes observées.
- Dimensions testées.
- Mode navigateur ou standalone.
- État authentifié ou non authentifié.
- Captures avant modification.
- Défauts confirmés et preuves.
- Défauts probables et méthode de reproduction.
- Écrans impossibles à inspecter et raison.

Ne commence pas par réécrire `globals.css`. Comprends la cascade actuelle et ses dépendances.

---

# 3. AUDIT VISUEL EXHAUSTIF — CHAQUE ÉCRAN ET CHAQUE ÉTAT

Inspecter au minimum, si ces fonctions existent dans le dépôt :

- Accueil / landing.
- Inscription, connexion, récupération de compte et OAuth.
- Onboarding et configuration initiale.
- Fil / feed.
- Stories : rail, viewer, réponses, création, édition, paramètres d'audience.
- Profils étudiant et professionnel.
- Profil personnel et modification du profil.
- Projets, pages projet, dépôts, branches, issues, pull requests et pages associées.
- Recherche et filtres.
- Messagerie, conversations, pièces jointes, composeur et états de lecture.
- Notifications.
- Communautés, groupes et membres.
- Signets, paramètres, préférences, sécurité et confidentialité.
- Écrans `/setup`, hors-ligne, erreurs, not-found et états de chargement.
- Tous les menus contextuels, dialogues, popovers, sheets et panneaux latéraux.

Pour chaque écran, vérifier au minimum ces états :

1. Chargement initial.
2. Chargement lent.
3. Contenu normal.
4. Contenu vide.
5. Contenu très long.
6. Texte long ou nom inhabituel.
7. Erreur serveur.
8. Absence de réseau.
9. Utilisateur non autorisé.
10. Action en cours.
11. Action réussie.
12. Action échouée et possibilité de réessayer.
13. Dialogue ouvert.
14. Clavier logiciel ouvert sur mobile, si un champ est présent.
15. Thème/contraste disponible réellement dans le produit.

### Inspection visuelle à effectuer

- Hiérarchie de titres.
- Alignement horizontal et vertical.
- Densité de contenu.
- Marges externes et padding.
- Espacements entre éléments liés et non liés.
- Cohérence des hauteurs de lignes.
- Taille des boutons et zones tactiles.
- États hover, focus, active, pressed, disabled, loading et selected.
- Couleurs texte/fond et contraste réel.
- Épaisseur des bordures.
- Rayons de coins.
- Ombres et élévation.
- Flous et transparences.
- Recadrage des photos et vidéos.
- Alignement des avatars.
- Troncature et retour à la ligne.
- Débordements horizontaux et verticaux.
- Éléments cachés derrière les barres fixes.
- Cohérence des icônes.
- Feedback après chaque action.
- Cohérence entre l'aperçu et le rendu publié.

Une page n'est pas validée parce qu'elle « semble correcte » sur un seul écran de bureau.

---

# 4. DIRECTION ARTISTIQUE — LIQUID IVOIRE, PAS UN TEMPLATE IA

## 4.1. Intention esthétique

L'impression recherchée est celle d'un produit numérique éditorial, calme, précis, tactile et soigneusement fabriqué. L'interface doit être reconnaissable sans logo : composition, typographie, couleur, rythme et détails doivent appartenir à DEVNET.

L'esthétique doit être :

- Minimaliste, mais pas vide.
- Chaleureuse, mais pas rustique.
- Technique, mais pas froide.
- Sophistiquée, mais pas ostentatoire.
- Dense, mais respirante.
- Expressive par la typographie et la composition, pas par des effets décoratifs gratuits.

## 4.2. Palette et couleurs

Prendre `#C5D58C` comme accent de marque connu, mais inspecter la palette effectivement utilisée avant de définir les autres valeurs.

Créer un système de tokens sémantiques, par exemple :

- `--color-canvas` : fond global ivoire.
- `--color-surface` : surface principale.
- `--color-surface-raised` : surface flottante.
- `--color-ink` : texte principal graphite.
- `--color-ink-muted` : texte secondaire.
- `--color-ink-subtle` : métadonnées non essentielles.
- `--color-border` : bordure subtile.
- `--color-border-strong` : séparation plus visible.
- `--color-accent` : olive de marque.
- `--color-accent-strong` : variante plus contrastée pour les textes et contrôles si le ton clair ne passe pas les WCAG.
- `--color-success`, `--color-warning`, `--color-danger`, `--color-info` : couleurs sémantiques réservées.
- `--color-overlay` : voile modal.
- `--color-focus` : anneau de focus.

Les valeurs exactes non documentées doivent être choisies après inspection du rendu existant et validation du contraste.

Règles impératives :

- Ne pas utiliser l'olive clair comme texte de petite taille sur fond ivoire si le contraste est insuffisant.
- Ne pas utiliser plusieurs accents concurrents sur un même écran.
- Ne pas coder les couleurs directement dans les composants si un token existe.
- Ne pas faire dépendre la compréhension d'un état uniquement de la couleur.
- Ne pas ajouter un mode sombre sans vérifier la décision de marque existante et l'état actuel du code. Si la marque est volontairement mono-thème, préserver ce choix et documenter le comportement système.
- Vérifier la barre de statut iOS et la couleur de la zone qui l'entoure dans le mode installé.

## 4.3. Ce qui est interdit — anti « AI slop »

Ne pas produire :

- Des dégradés violet/bleu/rose par défaut.
- Des halos lumineux derrière chaque section.
- Des blobs décoratifs abstraits sans rôle fonctionnel.
- Du glassmorphism sur chaque carte.
- Des ombres énormes et diffuses.
- Des panneaux flottants qui se chevauchent sans nécessité.
- Des cards dans des cards dans des cards.
- Des boutons capsule partout.
- Des titres gigantesques pour remplir l'écran.
- Des espaces vides artificiels et des blocs de présentation disproportionnés.
- Des illustrations génériques d'IA.
- Des emoji à la place d'icônes d'interface.
- Des gradients de marque Instagram copiés.
- Des graphiques et statistiques décoratifs sans données réelles.
- Des bordures et séparateurs sur chaque élément.
- Des animations « spring » excessives.
- Des toasts qui masquent le contenu ou se multiplient.
- Des modales pour des actions qui peuvent être effectuées dans un menu ou une sheet simple.
- Des copies de l'interface iOS ou d'une application sociale existante.

Chaque élément décoratif doit avoir une fonction et améliorer la compréhension ou la perception du produit. Sinon, le supprimer.

## 4.4. Surfaces et matière

Utiliser le verre comme une matière de profondeur avec retenue :

- Cartes de contenu : surfaces lisibles, bordures fines et ombres de contact légères ; pas de blur permanent.
- Barre de navigation, menus flottants et contrôles superposés : transparence et blur possibles, avec fallback opaque.
- Ne jamais appliquer `backdrop-filter` sur des milliers d'éléments ou sur une grande liste défilante.
- Sur fond complexe, garantir le contraste par une surface de support.
- Vérifier Safari iOS et les appareils modestes.

## 4.5. Typographie

Définir une hiérarchie unique et appliquée partout :

- Police de lecture principale issue de la décision documentée et vérifiée dans le runtime.
- Police monospace uniquement pour code, identifiants techniques, timestamps de terminal ou données tabulaires qui y gagnent réellement.
- Titres expressifs mais courts.
- Texte de lecture confortable.
- Métadonnées visuellement secondaires, jamais illisibles.

Tailles de référence à ajuster selon les usages :

- Texte courant mobile : généralement 15–16 px.
- Texte d'action important : 14–16 px.
- Métadonnées : généralement 12–13 px, seulement si elles sont vraiment secondaires.
- Éviter le texte essentiel sous 12 px.
- Hauteur de ligne suffisante et longueur de ligne maîtrisée.
- Supporter le zoom et les préférences d'accessibilité.

Ne pas réduire la police pour faire rentrer un layout cassé : adapter d'abord la mise en page.

---

# 5. SYSTÈME DE DESIGN — SOURCE DE VÉRITÉ UNIQUE

Créer ou rationaliser un design system partagé plutôt que multiplier des classes ponctuelles.

## 5.1. Tokens

Centraliser :

- Palette.
- Typographie.
- Échelle d'espacement.
- Rayons.
- Bordures.
- Ombres.
- Élévations.
- Durées et courbes de transition.
- Largeurs de contenu.
- Hauteurs de navigation.
- Tailles des icônes.
- Z-index.
- Safe areas.

Utiliser une échelle cohérente (base 4 ou 8 selon le système existant), et limiter les valeurs arbitraires aux véritables exceptions justifiées.

## 5.2. Composants fondamentaux

Définir ou harmoniser :

- Button (primary, secondary, tertiary, destructive, icon-only).
- IconButton.
- TextField, TextArea, SearchField, Select.
- Checkbox, Switch, Radio.
- Avatar et AvatarGroup.
- Badge et StatusIndicator.
- Tooltip.
- Menu et ContextMenu.
- BottomSheet.
- Dialog / AlertDialog.
- Toast / Snackbar.
- Tabs / SegmentedControl.
- ListItem.
- Card et Surface.
- Skeleton.
- EmptyState.
- ErrorState.
- LoadingState.
- Toolbar.
- NavigationBar.
- Composer.
- MediaPreview.

Chaque composant doit avoir :

- API TypeScript explicite.
- États visuels cohérents.
- Taille tactile appropriée.
- Label accessible.
- Gestion focus clavier.
- Comportement disabled/loading.
- Tests de base.

Ne crée pas dix variantes qui ne diffèrent que par une valeur de padding.

## 5.3. Rayons et géométrie

Définir 3 à 5 niveaux maximum : petit contrôle, contrôle standard, carte, grand panneau/modal et forme circulaire. Respecter l'intention de la DA ; ne pas appliquer un rayon maximal à tous les boutons et à toutes les cartes.

## 5.4. Icônes

Utiliser Lucide de manière uniforme si c'est bien le système retenu dans le dépôt.

Règles :

- Un seul langage iconographique.
- Tailles cohérentes : environ 16, 18, 20, 22 ou 24 px selon la hiérarchie.
- Épaisseur de trait uniforme.
- Alignement optique vérifié, pas seulement géométrique.
- Icône toujours associée à un libellé lorsque le sens n'est pas universel.
- Les boutons icon-only doivent avoir un nom accessible et une zone tactile suffisante.
- Pas d'emoji comme substitut à `plus`, `search`, `send`, `settings`, `heart`, `message`, `bookmark`, etc.
- Pas de mélange aléatoire entre outline, filled, emoji et SVG dessinés à la main.
- Pas d'icône différente pour la même action sur deux écrans.
- Les icônes d'état doivent être cohérentes (vue ≠ like, envoyer ≠ partager, fermer ≠ retour).

Établir un mapping documenté des actions vers leurs icônes dans le code.

---

# 6. ARCHITECTURE MOBILE — L'IPHONE EST UN FORMAT DE PREMIÈRE CLASSE

L'application doit être conçue d'abord pour les contraintes compactes d'un téléphone, puis enrichie pour desktop. Cela ne signifie pas simplement réduire le desktop.

## 6.1. Navigation

Étudier les destinations réellement utilisées et définir une navigation mobile claire.

Si le produit possède plusieurs destinations principales, envisager une barre d'onglets inférieure à 4 ou 5 destinations maximum, avec :

- Icône cohérente.
- Libellé court.
- État sélectionné clair.
- Zone tactile adaptée.
- Badge uniquement lorsqu'il indique une information réelle.
- Respect de l'inset inférieur iPhone.

Les actions secondaires doivent rester dans les menus contextuels, l'en-tête ou des sheets ; ne pas surcharger la barre principale.

Sur écran large, utiliser la navigation de bureau appropriée (barre supérieure, rail ou sidebar) sans changer la logique des destinations.

Ne jamais afficher deux systèmes de navigation concurrents sur mobile.

## 6.2. Compacité maîtrisée

Objectif : rendre beaucoup d'informations utiles accessibles sans faire défiler inutilement.

- Réduire les titres et paddings décoratifs sur petit écran.
- Prioriser le contenu réel au-dessus de la ligne de flottaison.
- Éviter les cartes de hauteur fixe si le contenu varie.
- Ne pas enfermer des listes dans des cartes imbriquées.
- Éviter les marges latérales énormes.
- Garder un padding latéral constant, confortable et adapté aux écrans très étroits.
- Utiliser des panneaux plein écran sur mobile lorsque c'est plus naturel qu'une petite fenêtre flottante.
- Garder les actions fréquentes accessibles au pouce.
- Placer les actions destructives dans des menus ou dialogues de confirmation adaptés, sans les rendre omniprésentes.

Compacité ne signifie jamais : texte minuscule, icônes microscopiques, tap targets de 24 px ou densité excessive.

## 6.3. Largeurs et hauteurs

Tester les formats étroits (320–360 px), les iPhone courants, les modèles grands et les vues paysage.

- Éviter les largeurs fixes qui dépassent le viewport.
- Utiliser `min-width: 0` sur les enfants flex/grid quand nécessaire.
- Tester les mots longs, URLs, codes et noms d'utilisateurs.
- Éviter de baser toute la hauteur sur `100vh`.
- Utiliser `100dvh` avec fallback adapté, et `svh`/`lvh` lorsqu'une différence de comportement est nécessaire.
- Gérer le changement d'orientation et les variations du viewport.
- Respecter la Dynamic Island, l'encoche, les coins et le Home Indicator.

---

# 7. PWA IPHONE — COMPORTEMENT NATIF ET LIMITES HONNÊTES

Tu dois vérifier le manifeste, les icônes, le service worker, le viewport, les métadonnées iOS, le thème, les routes de démarrage et les comportements standalone actuels.

## 7.1. Mode installé

Contrôler et, si nécessaire, corriger :

- Manifest Web App : `name`, `short_name`, `start_url`, `scope`, `display` ou `display_override` si justifié, `theme_color`, `background_color`, icônes adaptées et raccourcis valides.
- Icônes spécifiques iOS / Apple Touch Icon, nettes et sans marges involontaires.
- Métadonnées nécessaires au mode web app iOS, sans ajouter des balises historiques sans vérifier leur utilité actuelle.
- Couleur de barre de statut cohérente avec le fond réellement visible.
- Écran de lancement et états de reprise.
- Mode standalone et comportement en onglet navigateur.
- Mise à jour du service worker et signal clair lorsqu'une nouvelle version est disponible.

Ne pas supposer que toutes les versions iOS se comportent de façon identique. Tester les appareils/versions disponibles et documenter les différences.

## 7.2. Viewport et safe areas

Vérifier une déclaration de viewport adaptée, généralement avec `width=device-width` et `viewport-fit=cover` si le layout gère explicitement les safe areas.

Utiliser les variables CSS :

- `env(safe-area-inset-top)`
- `env(safe-area-inset-right)`
- `env(safe-area-inset-bottom)`
- `env(safe-area-inset-left)`

Créer des tokens de layout comme `--safe-top`, `--safe-bottom`, etc., avec fallback à zéro.

Exemples de principe, à adapter à la structure existante :

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}

.app-shell {
  min-height: 100vh;
  min-height: 100dvh;
  padding-inline-start: var(--safe-left);
  padding-inline-end: var(--safe-right);
}

.mobile-tabbar {
  padding-bottom: max(0.5rem, var(--safe-bottom));
}
```

Ne pas ajouter ces snippets aveuglément : éviter les doubles insets si un parent ou un navigateur les gère déjà.

## 7.3. Clavier logiciel iOS

Le clavier doit être traité comme un état majeur de l'interface, surtout pour Messages, Recherche, commentaires, formulaires et éditeur de stories.

- Observer `window.visualViewport` quand nécessaire.
- Écouter `resize` et `scroll` de manière propre et nettoyer les listeners.
- Garder le composeur visible au-dessus du clavier.
- Empêcher le clavier de couvrir le champ actif ou le bouton d'envoi.
- Éviter les sauts de layout et les doubles scrolls.
- Ne pas fixer arbitrairement une hauteur constante pour le clavier.
- Ne pas appliquer une logique Android `interactive-widget` en supposant qu'elle fonctionne sur Safari iOS.
- Préserver la position de lecture dans les conversations et les formulaires.
- Vérifier les champs `inputmode`, `autocomplete`, `enterkeyhint` et les types HTML pertinents.

## 7.4. Gestes et scroll

- Les gestes doivent être locaux et prévisibles.
- Utiliser `touch-action` uniquement sur les zones qui possèdent réellement un geste personnalisé.
- Ne pas détourner le balayage navigateur de retour/avant.
- Ne pas bloquer le scroll vertical normal pour ajouter un geste décoratif.
- Gérer `pointerdown`, `pointerup`, `pointercancel`, `pointerleave` et les interruptions.
- Éviter les conflits entre clic, appui long, swipe, sélection texte et scroll.
- Préserver le comportement de sélection/copier/coller dans les champs et textes.
- Respecter `prefers-reduced-motion`.

## 7.5. Capacités web et fallbacks

Détecter la disponibilité des API au lieu de supposer leur présence : caméra, micro, partage, clipboard, notifications, vibration, fichiers, background sync et autres fonctions.

- Demander une permission uniquement après une action explicite.
- Expliquer les limitations si une capacité n'est pas disponible.
- Prévoir un fallback utilisable.
- Ne jamais afficher un bouton qui ne peut pas agir.
- Ne pas prétendre offrir une notification push iOS si l'implémentation et les conditions de plateforme ne sont pas validées.
- Ne jamais simuler un retour haptique si l'API n'est pas disponible.
- Ne pas conserver des caches privés ou des pages authentifiées dans le service worker sans stratégie de sécurité explicite.

## 7.6. Installation

Sur iOS, expliquer simplement le parcours d'installation via le partage et l'écran d'accueil, en vérifiant le comportement des versions prises en charge. Sur les navigateurs supportant le prompt natif, utiliser le mécanisme réel. Ne pas afficher sans discernement un panneau d'installation permanent.

L'invite doit être contextuelle, non intrusive, dismissible et ne pas se répéter à chaque ouverture.

---

# 8. INTERACTIONS — CHAQUE ACTION DOIT ÊTRE PRÉCISE ET SATISFAISANTE

Faire un inventaire de tous les éléments interactifs et définir pour chacun : déclencheur, action, feedback, état de chargement, résultat, erreur, annulation, clavier et geste.

## 8.1. Boutons

- États `default`, `pressed`, `focus-visible`, `disabled`, `loading`, `success` si pertinent.
- Feedback immédiat, sans double soumission.
- Spinner seulement pour les opérations qui durent réellement.
- Libellé stable ; ne pas faire sauter la mise en page au chargement.
- Boutons destructifs explicitement identifiés.
- Boutons icon-only avec nom accessible.

## 8.2. Menus, popovers et sheets

- Ouverture à proximité de l'élément déclencheur.
- Positionnement qui évite les bords du viewport et les safe areas.
- Fermeture par action extérieure lorsque approprié.
- Échap sur desktop.
- Retour arrière Android/iOS browser lorsque pertinent et sans casser la navigation.
- Focus placé dans le dialogue puis restauré à sa fermeture.
- Scroll interne maîtrisé.
- Pas de menu hors écran.
- Sur iPhone, bottom sheet adaptée au pouce si plus naturelle qu'un popover minuscule.

## 8.3. Formulaires

- Labels persistants, pas seulement des placeholders.
- Erreurs près du champ concerné.
- Validation au bon moment ; ne pas interrompre chaque frappe inutilement.
- Préserver les données en cas d'erreur réseau.
- Bouton d'envoi accessible au clavier et au toucher.
- Clavier adapté au type de champ.
- Éviter les focus automatiques qui ouvrent le clavier à l'arrivée sans intention claire.

## 8.4. Navigation et transitions

- Préserver l'historique et le bouton retour.
- Pas de page blanche entre deux routes.
- Conserver les positions de scroll quand cela a du sens.
- Transitions courtes et non bloquantes.
- Éviter les transitions qui retardent l'accès au contenu.
- Respecter les préférences de réduction des animations.

## 8.5. Feedback système

Utiliser des toasts/snackbars avec parcimonie. Les messages importants ne doivent pas disparaître trop tôt. Les erreurs doivent expliquer quoi faire ensuite. Les succès doivent confirmer une action réelle, pas le simple déclenchement d'une requête.

## 8.6. États vides, erreurs, chargement et hors ligne

Créer des états conçus, sobres et utiles :

- Dire pourquoi la liste est vide.
- Proposer une action réellement disponible.
- Éviter les illustrations génériques.
- Utiliser des skeletons proches de la géométrie du contenu.
- Ne pas afficher de skeleton si le contenu peut apparaître immédiatement.
- Distinguer absence de données, absence de connexion et erreur serveur.
- Donner un bouton Réessayer quand c'est pertinent.
- Afficher clairement le mode démo et les données de démonstration.

---

# 9. STORIES — QUALITÉ VISUELLE ET TACTILE

Le système Stories doit rester une expérience DEVNET originale, inspirée par les usages connus sans copier les marques concurrentes.

À contrôler :

- Rail compact, avatars réels quand disponibles, anneau d'état cohérent.
- État nouvelle/consultée/personnelle compréhensible.
- Nom et métadonnées lisibles sans encombrer le rail.
- Viewer plein écran, médias correctement cadrés, barres de progression fines et synchronisées.
- Contrôles suffisamment grands mais visuellement discrets.
- Zones tactiles gauche/droite sans empêcher les actions sur les éléments interactifs.
- Appui long pause/resume fiable même lorsque le pointeur touche un média ou un sticker.
- Passage automatique entre stories et auteurs selon les règles produit.
- Vidéo synchronisée avec sa durée réelle et son événement de fin.
- Pause lorsque le viewer n'est plus visible ou qu'un menu bloque la lecture.
- Réponses et réactions faciles à atteindre sans masquer le contenu.
- Statistiques accessibles au propriétaire uniquement.
- Menus et confirmations sans empilement de modales.

Pour l'éditeur :

- Surface 9:16 adaptative sans rognage des commandes.
- Toolbar compacte et compréhensible.
- Prévisualisation strictement fidèle au rendu exporté.
- Texte, stickers, dessins et autres objets positionnables avec poignées nettes.
- Sélection visuelle claire d'un objet.
- Undo/redo visible et réellement fonctionnel.
- Barre d'outils contextuelle qui ne couvre pas le média.
- Publication avec progression réelle, erreurs récupérables et brouillon préservé.
- Gestion du clavier et des gestes.
- Pas de controls décoratifs ou simulés.

Ne pas transformer le viewer en écran surchargé de boutons. Utiliser la révélation progressive : montrer les actions les plus fréquentes, regrouper les autres dans un menu.

---

# 10. RESPONSIVE ET MATRICE DE TEST

Tester au minimum avec Playwright/emulation et, lorsqu'ils sont disponibles, des appareils physiques :

## Téléphones

- 320 × 568 : petit écran / cas contraint.
- 360 × 800 : Android compact.
- 375 × 812 : iPhone compact.
- 390 × 844 : iPhone courant.
- 393 × 852 : iPhone courant récent.
- 402 × 874 : grand iPhone.
- 430 × 932 : grand format.

## Tablettes et desktop

- 768 × 1024.
- 834 × 1194.
- 1024 × 768.
- 1280 × 800.
- 1440 × 900.
- 1920 × 1080.

Tester :

- Portrait et paysage.
- Navigateur Safari iOS et mode ajouté à l'écran d'accueil.
- Chrome Android et mode standalone.
- Desktop Chromium.
- Clavier logiciel affiché.
- Texte et zoom système lorsque le test est disponible.
- Réseau lent et offline.

**Important :** Playwright Desktop en viewport iPhone n'est pas une preuve de compatibilité Safari iOS. Tester réellement au moins un iPhone lorsque possible. Sinon, marquer explicitement les vérifications physiques comme non effectuées.

---

# 11. ACCESSIBILITÉ ET ERGONOMIE

Respecter au minimum :

- Zones tactiles d'environ 44 × 44 CSS px pour les contrôles importants, sans réduire la surface pour gagner quelques pixels.
- Contraste conforme WCAG 2.2 AA pour le texte et les contrôles, avec vérification des états désactivés et focus.
- `:focus-visible` visible et cohérent.
- Labels accessibles sur inputs et boutons icon-only.
- HTML sémantique avant ARIA.
- Ordre de tabulation logique.
- Focus géré dans les dialogues et sheets.
- Alternative clavier à chaque geste.
- Textes alternatifs pertinents.
- Annonces `aria-live` réservées aux messages réellement importants.
- `prefers-reduced-motion` respecté.
- Zoom navigateur non désactivé arbitrairement.
- Contraste en plein soleil raisonnable.
- Ne jamais utiliser uniquement la couleur pour signaler un statut.

Ne pas définir globalement `user-select: none`. Limiter cette règle aux zones de gestes lorsque cela est nécessaire.

---

# 12. PERFORMANCE — SENSATION D'APPLICATION NATIVE

La qualité visuelle doit rester fluide sur des téléphones de gamme moyenne ou ancienne.

## 12.1. Rendu

- Éviter les re-renders inutiles des listes et médias.
- Virtualiser uniquement les longues listes où cela apporte réellement un gain.
- Éviter les layouts complexes et effets coûteux sur chaque ligne.
- Limiter les blur/backdrop-filter.
- Animer principalement `transform` et `opacity`.
- Éviter d'animer `width`, `height`, `top`, `left`, `filter` ou de grandes ombres en boucle.
- Utiliser `will-change` avec modération et uniquement sur les éléments animés.
- Nettoyer timers, observers et listeners.

## 12.2. Médias

- Images responsive (`srcset`, `sizes` ou mécanisme Next/Image approprié).
- Formats optimisés AVIF/WebP lorsque supportés et utiles.
- Dimensions réservées pour empêcher les layout shifts.
- Lazy loading sous la ligne de flottaison.
- Priorité adaptée au contenu principal visible.
- Miniatures pour les vidéos et médias lourds.
- Ne pas précharger une série complète de vidéos.
- Arrêter/libérer les médias hors écran.

## 12.3. Polices

- Limiter le nombre de familles et variantes.
- Charger les fontes localement avec la stratégie compatible Next.js.
- Limiter le poids et les axes inutiles.
- Prévenir les changements de layout lors du chargement.
- Vérifier les caractères accentués et les glyphes réellement utilisés.

## 12.4. Mesures

Collecter une baseline, puis comparer :

- LCP.
- CLS.
- INP.
- Poids JS initial.
- Nombre de requêtes initiales.
- Temps avant contenu interactif.
- Long tasks.
- FPS des transitions et gestes lorsque mesurable.

Utiliser les Core Web Vitals comme garde-fous, pas comme substitut à l'évaluation tactile réelle.

---

# 13. AUDIT ET OUTILLAGE VISUEL

Utiliser les outils déjà présents dans le dépôt avant d'ajouter de nouvelles dépendances.

Compléter si nécessaire :

- Playwright screenshots.
- Tests de parcours interactifs.
- Comparaison visuelle baseline/après.
- Vérification axe/accessibilité.
- Détection de débordements.
- Tests de navigation clavier.
- Tests tactiles via événements appropriés.
- Tests de chargement du clavier simulé lorsque possible.

Pour chaque route importante, produire les mêmes captures avant/après, avec le même viewport et le même état de données.

### Détection automatisée minimale

Créer un contrôle qui signale :

- Scroll horizontal inattendu.
- Éléments avec bounding box hors viewport.
- Texte coupé sans stratégie de troncature volontaire.
- Boutons sans nom accessible.
- Champs sans label.
- Images sans dimensions réservées.
- Contrôles interactifs trop petits.
- Dialogues sans nom ou gestion de focus.
- Couleurs hardcodées hors tokens, sauf exception documentée.

Ne pas confondre résultat de scan statique et validation visuelle. Le navigateur doit être utilisé pour voir le rendu final.

---

# 14. MÉTHODE DE CORRECTION — NE PAS FAIRE UNE REFONTE AVEUGLE

## Phase 1 — Baseline

Capturer et inventorier le produit actuel. Ne rien modifier avant d'avoir compris les routes et composants actifs.

## Phase 2 — Diagnostic priorisé

Créer `docs/uiux/ISSUES.md` avec pour chaque problème :

- Identifiant.
- Route/composant.
- Capture ou reproduction.
- Cause.
- Impact utilisateur.
- Gravité.
- Statut confirmé/probable/à vérifier.
- Correction proposée.
- Test de validation.

Priorités :

- P0 : action impossible, perte de données, contenu caché, accessibilité bloquante ou défaillance majeure.
- P1 : défaut fréquent ou très visible, navigation confuse, contrôles tactiles inadaptés.
- P2 : incohérence visuelle ou friction régulière.
- P3 : raffinement esthétique ou amélioration marginale.

## Phase 3 — Fondations du design system

Consolider palette, typographie, espaces, rayons, icônes, boutons, champs, menus et surfaces. Ne pas introduire un nouveau système en parallèle.

## Phase 4 — Coquille native mobile

Corriger viewport, safe areas, navigation mobile, header, tab bar, clavier logiciel, sheets et transitions.

## Phase 5 — Écrans prioritaires

Traiter dans cet ordre, selon les parcours réels :

1. Authentification et onboarding.
2. Feed et navigation principale.
3. Messagerie et composeur.
4. Profils et projets.
5. Recherche et notifications.
6. Stories viewer et éditeur.
7. Communautés, groupes et paramètres.
8. États d'erreur, offline, setup et pages secondaires.

## Phase 6 — Interactions et accessibilité

Vérifier chaque bouton, menu, geste, formulaire, dialogue et état. Corriger les conflits d'interaction avant d'ajouter des animations.

## Phase 7 — Performance et polish

Optimiser médias, fontes, animations et chargement. Ajouter seulement les transitions qui clarifient le changement d'état.

## Phase 8 — Validation

Comparer les captures avant/après, exécuter les tests et faire un parcours manuel complet sur chaque breakpoint prioritaire.

Ne pas effectuer un changement massif non réversible. Procéder par lots cohérents, conserver les tests verts et contrôler les régressions à chaque phase.

---

# 15. CRITÈRES DE QUALITÉ VISUELLE — GATE DE LIVRAISON

Un écran important ne peut être marqué « terminé » que si les éléments suivants sont vrais :

## Composition

- Hiérarchie évidente en moins de quelques secondes.
- Pas d'espace vide artificiel.
- Pas de surcharge d'informations.
- Marges cohérentes.
- Alignements nets.
- Aucun élément chevauché ou rogné.
- Les actions principales sont visibles et identifiables.

## Typographie et couleur

- Hiérarchie de texte cohérente.
- Lisibilité mobile.
- Contraste validé.
- Palette de marque respectée.
- Pas de couleurs arbitraires non justifiées.

## Icônes et contrôles

- Même action = même icône.
- Taille et trait cohérents.
- Pas d'emoji utilisé comme icône fonctionnelle.
- Contrôles suffisamment grands.
- États d'interaction visibles.

## Mobile iPhone

- Respect des safe areas.
- Navigation accessible au pouce.
- Barre basse au-dessus du Home Indicator.
- Aucun contrôle caché derrière le clavier.
- Aucun scroll horizontal involontaire.
- Pas de double scroll gênant.
- Gestes précis sans conflit avec le scroll système.
- L'application reste utilisable en mode navigateur et standalone.

## Mouvement et performance

- Animations courtes, utiles et fluides.
- Pas de blur généralisé.
- Pas de jank majeur pendant le scroll.
- Pas de flash ou déplacement brutal du layout.
- Préférence reduced motion prise en compte.

## Comportement

- Chaque contrôle fonctionne.
- Erreurs et succès sont explicites.
- Données préservées en cas d'erreur.
- États vides et offline conçus.
- Aucun bouton factice.

---

# 16. LIVRABLES OBLIGATOIRES

À la fin, fournir :

1. `docs/uiux/BASELINE.md` — état initial et routes inspectées.
2. `docs/uiux/ISSUES.md` — registre des bugs visuels et UX avec preuves et statuts.
3. `docs/uiux/DESIGN-SYSTEM.md` — tokens, typographie, icônes, composants, usages et exceptions.
4. Captures avant/après, classées par route et viewport.
5. Code réellement corrigé.
6. Tests ajoutés et résultats exacts.
7. Matrice des appareils/breakpoints testés.
8. Liste des points non vérifiés sur appareil physique.
9. Liste des compromis PWA iOS connus.
10. Liste des changements et éventuelles régressions restantes.

Si le dépôt utilise une autre convention de documentation, respecte-la et place les fichiers dans son dossier documentaire existant.

---

# 17. RÈGLES DE PROTECTION

- Ne pas supprimer ni réécrire des pages sans comprendre leur rôle.
- Ne pas changer les flux métier pour obtenir une capture plus jolie.
- Ne pas désactiver une fonctionnalité pour masquer un défaut UI.
- Ne pas casser les raccourcis, routes, deep links ou historiques.
- Ne pas modifier le schéma ou les données de production pour des raisons visuelles.
- Ne pas ajouter une dépendance lourde sans justification.
- Ne pas remplacer Tailwind ou Next.js.
- Ne pas retirer des fonctionnalités d'accessibilité pour imiter une application native.
- Ne pas désactiver le zoom utilisateur.
- Ne pas utiliser de données inventées dans les statistiques ou les profils.
- Ne pas montrer de fausses confirmations.
- Ne pas committer les captures de données privées ou personnelles.
- Ne pas écraser les modifications locales de l'utilisateur.
- Conserver la licence MIT et respecter toutes les licences tierces.

---

# 18. INSTRUCTION FINALE À L'AGENT

Tu dois maintenant travailler dans le dépôt DEVNET.

Commence par vérifier l'état Git et lire les instructions du projet. Inspecte le code réel, les routes et le rendu actuel. Capture les écrans avant modification. Audite toutes les interactions et tous les breakpoints essentiels. Construis ensuite le registre des problèmes avec preuves.

Préserve la direction artistique Liquid Ivoire documentée : fond ivoire mat, accent olive `#C5D58C`, graphite, verre réservé aux surfaces flottantes, typographie et icônes cohérentes. Vérifie les polices réellement chargées et résous les contradictions de documentation avant de toucher au système typographique.

Ton objectif n'est pas de faire « plus moderne » avec des effets génériques. Ton objectif est de créer une interface DEVNET rare, élégante, lisible, compacte, précise, chaleureuse et immédiatement reconnaissable.

Sur iPhone, l'application doit occuper correctement l'écran, respecter les safe areas et le clavier, conserver des zones tactiles confortables, offrir une navigation naturelle au pouce, éviter les sauts de layout, gérer les gestes proprement et rester rapide. Utilise les capacités PWA réellement disponibles et propose des fallbacks honnêtes lorsque Safari iOS impose une limite.

Ne te contente pas d'un audit. Corrige les problèmes confirmés, améliore les composants réutilisables, teste les parcours et compare les captures. Répète le cycle jusqu'à ce que les critères de qualité soient satisfaits.

À chaque phase, indique ce qui a été modifié, ce qui a été testé, ce qui reste incertain et pourquoi. Ne prétends jamais avoir testé un iPhone réel si tu n'en as pas utilisé un.

**Livraison attendue : une vraie application DEVNET, pas une maquette, qui donne l'impression d'un produit soigneusement conçu et entretenu par une équipe de design et d'ingénierie expérimentée.**
