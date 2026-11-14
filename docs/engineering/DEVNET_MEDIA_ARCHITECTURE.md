# DEVNET — architecture média

> État vérifié le 2026-11-14. Décrit le flux réel, ses limites mesurables et la
> migration cible. Aucune migration destructive n'est incluse.

## 1. Flux actuel

### Photos et vidéos de publication / message

1. Le navigateur compresse une photo (`lib/media.ts`, WebP, 1920 px max,
   qualité 0.82). Un GIF est laissé intact.
2. `POST /api/media` (multipart) :
   - borne 4 Mo (corps de requête Vercel 4,5 Mo) ;
   - **signature binaire** puis décodage `sharp` obligatoire ;
   - réencodage WebP si plus léger ;
   - dépôt sur R2 (`R2_*`) ou Vercel Blob (`BLOB_READ_WRITE_TOKEN`) ;
   - repli explicite dans `public.media_files` si aucun stockage objet.
3. Au-delà de 4 Mo, une vidéo passe par `POST /api/media/multipart` :
   `create` (URL signées), `PUT` directs vers R2, `complete`, `abort`.
4. Lecture : `/api/media/[path]` redirige vers l'URL distante ou sert les
   octets de la base. Depuis la migration 067, la lecture applique
   `can_read_media_file` et le cache dépend de la confidentialité.

### Médias de story

1. Petite image/GIF (< 3 Mo) : data URL JSON → `POST /api/stories/media` →
   `sharp` (WebP borné 1080×1920) → `public.story_media` (`bytea`).
2. Vidéo ou fichier lourd : upload objet d'abord, puis URL. Depuis le
   correctif, l'URL doit être interne (et possédée), du stockage configuré ou
   d'un fournisseur GIF ; une URL tierce est refusée.
3. Vidéo en data URL : `ffmpeg` (MP4/H.264, 720 px, 15 s), avec délai strict
   de 90 s, journaux bornés et nettoyage du répertoire temporaire.
4. Lecture : `/api/stories/[id]/media`, authorization par la story,
   `Cache-Control: private, no-store`.

## 2. Limites et décisions

| Sujet | Valeur | Raison |
|---|---|---|
| Corps d'une fonction | 4 Mo applicatif (4,5 Mo plateforme) | évite un 413 opaque |
| Vidéo par morceaux | 100 Mo | upload mobile et stockage gratuit |
| Partie R2 | ≥ 5 Mo, 12 parties cible | contrainte S3 |
| Image de story | 6 Mo en entrée, 900 Ko WebP (3 Mo GIF animé) | budget de lecture mobile |
| Vidéo de story | 40 Mo en entrée, 15 s, 8 Mo en sortie | transcodage serverless |
| `sharp` | `limitInputPixels: 40–50 M` | bombes de décompression |
| `ffmpeg` | timeout 90 s, `SIGKILL` | processus qui patine |

## 3. Contrôles d'entrée

- Taille avant stockage et après réencodage.
- Signature binaire (`lib/media-signature.ts`) : JPEG, PNG, GIF, WebP, AVIF,
  MP4, QuickTime, WebM. HTML, SVG, PDF, script → refus.
- Type déclaré comparé à la famille détectée.
- Image réellement décodable par `sharp`.
- Nom de fichier imposé par le client mais **validé** :
  `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$` — aucun chemin serveur, aucune
  traversée.
- Identifiant d'upload et ETag bornés pour le multipart.
- Côté story : captions bornées, URL normalisée et allowlistée.

### Ce qui n'est pas encore vérifié

- **Multipart** : les octets ne repassent pas par le serveur, donc la
  signature n'est pas vérifiée à la finalisation. À faire en lisant les 64
  premiers octets de l'objet public (`Range`), puis en refusant et nettoyant.
- **EXIF/GPS** : `sharp` réencode les photos (donc retire les métadonnées),
  mais un GIF laissé intact conserve les siennes. Politique produit à fixer.
- **Nombre de pistes, codecs, résolution vidéo** : `ffprobe` ne lit que la
  durée et les dimensions. À compléter avant d'accepter des vidéos larges.

## 4. Confidentialité

| Chemin | Avant | Depuis le correctif |
|---|---|---|
| DB `media_files` | `using (true)`, cache immuable | `can_read_media_file` : public, auteur, participant, membre |
| `story_media` | policy story + cache 24 h | policy story + `no-store` |
| R2/Blob | URL publique permanente | **inchangé** — limite de l'architecture |

Un média privé stocké sur un bucket public reste accessible par son URL.
La correction complète est un bucket privé avec URLs signées à durée courte
(voir §5). Tant que ce n'est pas fait, le repli base est le seul chemin
réellement privé.

## 5. Architecture cible

1. `POST /api/media/authorize` : session, droit de publier, quota.
2. Clé imprévisible liée à l'utilisateur et à l'objet en préparation.
3. URL/jeton d'upload court, limité à un objet.
4. Envoi direct au stockage (pas de base64, pas de traversée Vercel).
5. `POST /api/media/complete` : vérifie existence, taille, signature,
   propriétaire, puis écrit les métadonnées.
6. Lecture par route autorisée ou URL signée (TTL ≤ durée de vie de l'objet).
7. Job idempotent : médias orphelins, expirés, objets sans métadonnées.

### Migration depuis `bytea`

- Mesurer le volume (`pg_total_relation_size`), pas le nombre de lignes.
- Migration additive : colonnes `storage_key`, `checksum`, `processing_status`.
- Copie par lots, checksum comparé, lecture historique conservée.
- Bascule des nouvelles publications seulement après validation.
- Suppression des anciennes colonnes uniquement après sauvegarde, validation
  et autorisation explicite.

## 6. Tests réellement disponibles

```bash
npx tsx scripts/test-media-security.ts   # signatures + allowlist d'URL
npm run test:api-stories                 # gestes stories (démo)
npm run test:pwa                         # coque et cache PWA
```

Tests à ajouter (voir `DEVNET_REMEDIATION_LEDGER.md`) : MIME falsifié envoyé à
`/api/media`, vidéo > 4 Mo sans R2, finalisation multipart répétée, objet
absent, accès non-participant à un média privé, purge après expiration.
