# DEVNET — modèle de sécurité

> État vérifié le 2026-11-14. Ce document décrit ce que le code **fait**, pas
> ce qu'on souhaiterait qu'il fasse. Les points marqués « bloquant » ne peuvent
> pas être fermés par une modification locale du dépôt.

## 1. Actifs

| Actif | Où il vit | Sensibilité |
|---|---|---|
| Comptes, profils, fil, messages | PostgreSQL (`public.*`) | Élevée |
| Sessions | cookie `devnet_session` + `public.auth_sessions` (empreinte SHA-256) | Élevée |
| Photos et vidéos | R2 / Vercel Blob, repli `public.media_files` | Élevée (messages privés) |
| Médias de story | `public.story_media` (`bytea`) | Élevée |
| Jeton GitHub | cookie chiffré, `lib/github/crypto.ts` | Critique |
| Secrets d'infrastructure | variables d'environnement Vercel/CI | Critique |

## 2. Acteurs et authentification

- **Anonyme** : peut lire les contenus marqués publics par les policies ; ne
  peut écrire aucun contenu.
- **Utilisateur authentifié** : identité lue depuis le cookie de session,
  résolue par `modules/auth` (`resolveSession`), jamais depuis un identifiant
  du corps de requête.
- **Administrateur** : `is_admin` + identité requise
  (`db/migrations/044_is_admin_requires_identity.sql`). `/admin` est filtré par
  `proxy.ts` (présence du cookie) puis par `app/admin/layout.tsx` (session
  valide + rôle).
- **Rôles PostgreSQL** : `anon`, `authenticated`, `service_role`. Le code
  applicatif s'exécute via `withAnon`/`withUser`, qui posent
  `SET LOCAL ROLE` et `request.jwt.claim.sub` dans une transaction ; rien ne
  persiste sur la connexion rendue au pool.

### Cookies

`modules/auth/http/session-cookie.ts` : `HttpOnly`, `SameSite=Lax`,
`Secure` en production, `Path=/`, expiration alignée sur la session.
Les cookies OAuth/GitHub suivent les mêmes attributs ; `secure` y est déduit
de l'origine publique.

## 3. Autorisation

- La RLS est la seconde barrière : les routes API passent par
  `withUser`/`withAnon`, donc une policy manquante produit un refus, pas une
  fuite.
- Les routes ne font jamais confiance à un `user_id`/`author_id` du corps :
  `currentUserId()` lit la session.
- Les objets médias viennent d'être alignés sur ce principe : la policy
  `media_files_read` appelle `public.can_read_media_file(path)`, qui autorise
  un média public, son auteur, un participant de la conversation privée ou un
  membre du groupe. Un non-participant reçoit 404, comme pour un chemin
  inexistant.
- Les routes Stories valident la forme des gestes (`readStoryAction`) et
  refusent tout identifiant invalide avant Postgres.

## 4. Rôles et RLS — points ouverts

| Constat | Risque | État |
|---|---|---|
| `grant anon, authenticated, service_role to devnet_u` (`db/bootstrap/roles.sql`, `db/compat/000_compat.sql`) | Le rôle applicatif peut endosser `service_role`, qui porte `BYPASSRLS` — la RLS devient facultative. | **Bloquant production.** Séparer rôle de migration et rôle de runtime, retirer `service_role` de `devnet_u`, tester `SET ROLE service_role` en échec. |
| Tables exposées sans `FORCE ROW LEVEL SECURITY` | Le propriétaire des tables contourne la RLS. | À vérifier sur la base cible ; le runtime doit être distinct du propriétaire. |
| Pas de test RLS en CI | Une policy cassée n'est vue qu'en production. | Ajouter un service PostgreSQL 18 en CI. |
| `authenticated` reçoit `execute` sur toutes les fonctions | Une fonction `security definer` mal écrite devient un contournement. | Auditer chaque fonction `security definer` (search_path fixé, grants minimaux). |

## 5. Médias

- **Entrée** : `/api/media` (multipart, 4 Mo) et `/api/media/multipart` (R2,
  parties signées, 100 Mo). Le type est vérifié par signature binaire
  (`lib/media-signature.ts`), puis par décodage `sharp` pour les images.
- **Sortie** : `/api/media/[path]` lit avec l'identité de session ; les
  médias privés sont servis `private, no-store`, les publics avec un cache
  immuable (le chemin est un UUID jamais réécrit).
- **Stories** : `story_media` garde les octets re-encodés (WebP/MP4). La route
  de lecture applique la policy de la story et ne met plus rien en cache.
- **Limite connue** : un média stocké sur R2/Blob avec une URL publique reste
  public par nature. La confidentialité des messages privés n'est complète
  que si le bucket est privé et la lecture signée — voir
  `DEVNET_MEDIA_ARCHITECTURE.md`.

## 6. Transport, secrets, sauvegardes

- TLS : `resolvePostgresConnection` refuse `sslmode=disable` vers un hôte
  distant sans `DATABASE_TLS_INSECURE=true`. Une URL sans `sslmode` donne
  `require` (chiffré, non vérifié) ; `verify-full` exige `DATABASE_CA_CERT`.
  **Objectif production : `verify-full` partout.**
- Secrets : jamais dans Git (`.env*` ignorés, gitleaks en CI). Le dépôt ne
  contient pas de valeur ; les noms sont documentés dans `.env.example`.
- Sauvegardes : voir `docs/ops/backups.md` (dump chiffré GPG, restauration
  testée, minuterie quotidienne). La phrase de passe reste hors coffre :
  point ouvert.
- En-têtes : `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy`, HSTS. Pas encore de CSP — à ajouter avec une
  politique compatible Next.js, testée en staging.

## 7. Menaces et contrôles

| Menace | Contrôle | Test |
|---|---|---|
| Lire le message privé de B | RLS + `can_read_media_file` + routes avec identité | test négatif A/B (à ajouter en CI) |
| Publier sous l'identité d'autrui | `author_id` ignoré, session seule | `scripts/test-api-stories.ts` |
| HTML/SVG déguisé en image | signature binaire + `sharp` | `scripts/test-media-security.ts` |
| Story pointant vers un tiers | allowlist d'URL | `scripts/test-media-security.ts` |
| Rejeu de session | jeton haché, expiration, révocation | `scripts/test-auth-postgres.ts` |
| Fuite de secret | gitignore + gitleaks + noms seuls | CI `secrets` |
| Déni de service média | limites de taille, timeout ffmpeg | à compléter par rate limiting |

## 8. Bloquants avant production

1. Rotation des secrets exposés et retrait de `service_role` du rôle applicatif.
2. `verify-full` effectif avec le CA du fournisseur.
3. Test négatif RLS exécuté sur la base cible (pas seulement en local).
4. Bucket média privé + URLs signées pour les messages privés.
5. Limitation de débit partagée entre instances.
