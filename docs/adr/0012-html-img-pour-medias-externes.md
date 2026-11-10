# 0012 — `<img>` HTML pour les médias externes, et non `next/image`

- Statut : accepté
- Date : 10 novembre 2026
- Contexte : PR-02 interdit `eslint-disable` sans ADR approuvé.

## Décision

Trois composants utilisent `<img>` avec
`{/* eslint-disable-next-line @next/next/no-img-element */}` : la carte de
publication, le sélecteur de GIF et la carte de story.

Raison : les sources sont des URL **externes arbitraires** (GIF Tenor/Giphy,
aperçus d'articles) et des `blob:` locaux. `next/image` exigerait
`remotePatterns` ouverts à tous les hôtes (proxy d'images servant n'importe
quelle origine) et ne sait pas optimiser un `blob:` d'aperçu.

## Conséquences

- Les images portent `loading="lazy"`, `decoding="async"` et des dimensions
  ou un conteneur borné (PF-04) : le défaut reste une image dimensionnée.
- Un sticker ou un GIF **de la maison** passe par la route d'asset ou un SVG
  local, pas par ces exceptions.
- Toute nouvelle occurrence de `no-img-element` exige une entrée ici.
