# Registre des défauts UI/UX — passe du 14 novembre 2026

Statut : `corrigé`, `documenté` (faux positif ou exception assumée), `ouvert`.
Chaque entrée renvoie à une mesure de `BASELINE.md` ou à une capture de
`docs/uiux/`.

| ID | Sévérité | Écran | Constat mesuré | Correctif | Statut |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Haute | Profil | L’onglet « Paramètres » mesurait 118 px et sortait à 457 px ; le bord droit était coupé à 320/360/390. | Barre d’onglets en **5 colonnes égales**, libellé « Réglages », 12 px, `min-w-0` ; suppression du défilement horizontal et du voile de bord. Les 5 onglets tiennent à 320 px (64 px chacun). | corrigé |
| UI-02 | Haute | Fil | À 320 px, le conteneur deux colonnes du fil imposait une largeur de page de **325 px** ; les trois filtres débordaient de 3 px. | `min-w-0` + `overflow-x-clip` sur le conteneur ; filtres à **11 px / padding réduit sous 340 px**. Largeur finale : **320/320**. | corrigé |
| UI-03 | Haute | Global | 195 textes sous 12 px (52 dans le fil, 52 dans le profil, 42 dans les projets). Libellés `label-micro` à 11 px, navigation à 10 px. | Tokens `--text-label` / `--text-micro` portés à **0,75 rem** ; tailles explicites 10/10,5/11/11,5 → **12 px** sur les écrans porteurs ; navigation 12 px (11 px ≤ 340 px). Résultat : **0** à 360/390. | corrigé |
| UI-04 | Haute | Projets | Segments « Découvrir / Mes projets » hauts de 30 px, filtres `select` de 34 px, bouton « recrute » de 34 px. | Tous portés à **44 px** (`min-h-[var(--h-tap)]`, `h-11`). Aucune cible < 44 px sur `/projects`. | corrigé |
| UI-05 | Moyenne | Connexion | Œil d’affichage du mot de passe : 40 × 42 px. Erreurs sans `aria-invalid` / `aria-describedby`. | Cible **44 × 44** ; `aria-invalid` et `aria-describedby="login-error"` sur email et mot de passe. Même traitement à l’inscription (`register-error`), + `rel="noopener noreferrer"` sur le lien CGU. | corrigé |
| UI-06 | Moyenne | Profil / carte projet | Le message de commit mesurait 421 px et le texte interne n’était pas tronqué ; la grille de projets élargissait la page à **363 px**. | Message en `block truncate` ; grille `grid-cols-1` + carte `min-w-0` + lien `min-w-0`. Largeur de page : **320 px**. | corrigé |
| UI-07 | Info | Fil | 30 jetons de code dépassaient le viewport à 390 px. | Faux positif : ils sont dans le `div overflow-auto` de `CodeBlock` (défilement horizontal prévu, `role=region`, `tabIndex=0`). Aucune page ne déborde. | documenté |
| UI-08 | Moyenne | Documentation | Le README décrivait « Liquid Ivoire » (ivoire unique, olive, onglets en haut, Inter seul) alors que le code implémente Encre/Papier/Savane/Savane clair, l’accent ambre/turquoise et une navigation basse. | README corrigé pour décrire la **DA réelle** ; note explicite : Liquid Ivoire n’est pas implémenté et toute refonte demande une décision. Aucun thème remplacé. | corrigé |
| UI-09 | Info | PWA | Risque de barre de statut incohérente en changeant de thème. | Vérifié : `PwaManager` met à jour `theme-color` par thème — `#11110E` (Encre), `#F6F4EF` (Papier), `#0B1715` (Savane), `#F4F1E8` (Savane clair) — et bascule `apple-mobile-web-app-status-bar-style`. | vérifié |
| UI-10 | Basse | Fil / profil / réglages | Liens inline et cases à cocher sous 44 px. | Non agrandis : exemption WCAG 2.5.8 (lien dans une phrase, input dans un label). Documenté, pas masqué. | documenté |
| UI-11 | Basse | Global | À 320 px, la navigation repasse à 11 px. | Arbitrage assumé : 12 px dès 340 px ; 11 px uniquement pour que les six onglets tiennent sans déborder. Alternative serait de supprimer un onglet. | documenté |
| UI-12 | Moyenne | Global | Test sur iPhone/Safari physique impossible dans cet environnement. | Limite déclarée ; tests Chromium émulé uniquement. Ne pas présenter l’émulation comme un test iPhone. | ouvert |
| UI-13 | Moyenne | Groupes / communautés | 12 textes < 12 px dans les groupes, 7 dans les communautés ; boutons « Rejoindre » hauts de 34/32 px. | Textes portés à 12 px ; boutons à 44 px. 0 texte < 12 px et 0 cible < 44 px à 360/390. | corrigé |
| UI-14 | Haute | Détail projet | 28 textes < 12 px ; barre d’outils du code à 32 px ; à 320 px, la ligne de branche et le bouton « Écrire » sortaient à 322 px. | Tailles à 12 px, boutons à 44 px, ligne de branche bornée (`min-w-0`, `max-w-[190px]`), barre d’outils en `flex-wrap` avec padding réduit sous 340 px. 0 débordement aux trois largeurs. | corrigé |
| UI-15 | Moyenne | Global | 2 315 valeurs Tailwind arbitraires, 206 textes < 12 px au cliquet. | 983 tokens passés en syntaxe v4 `(--token)`, 343 tailles `text-[12px]` remplacées par l’utilité `text-12` ; cliquet resserré à **1 124** valeurs et **115** textes. | corrigé |
| UI-16 | Moyenne | Direction artistique | Fond plat, titres sans voix propre, en-tête profil très vertical, score projet comprimant la description. | Lavis `--page-wash` par thème, titres Space Grotesk (Encre/Papier), identité profil sur une ligne, métriques allégées, score projet en pied de carte. Aucun thème remplacé. | corrigé |
| UI-17 | Haute | Global | Aucune porte automatique ne vérifiait les débordements ni le plancher typographique. | `tests/e2e/layout.spec.ts` : 3 largeurs × 8 écrans, échec sur débordement ou texte essentiel < 12 px ; `npm run test:layout`. | corrigé |

## Ce qui n’a pas été fait

- Pas de refonte de la direction artistique, pas de nouvelle maquette.
- Pas de remplacement des quatre thèmes existants.
- Pas de correction des 2 222 valeurs arbitraires ni des 685 tailles de texte
  du dépôt : la passe a traité les écrans et les composants mesurés.
- Pas de test exhaustif de tous les états (erreurs, chargement, modales) à
  chaque largeur.
