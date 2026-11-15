# Ticket Systalink — déblocage des rôles (résolu, conservé comme modèle)

> **Résolu le 2026-11-09** : les trois rôles ont été créés, les 52 migrations
> sont appliquées et le mot de passe a été renouvelé. Ne pas renvoyer ce ticket
> tel quel ; il reste la trace de la demande et un modèle pour un prochain
> incident d’administration. Les chiffres du corps (161 politiques, base vide)
> sont ceux du 2026-11-08, avant migration.

- **À** : `support@systalink.fr` ; **Copie** : `sadio.barry@systalink.fr`
  (ne pas utiliser `postmaster@systalink.fr` : rejeté le 7 novembre).
- **Objet** : `Base PostgreSQL devnet (ID 7040e8d0-16c2-4182-80f6-30cd3282aa9f) — 4 lignes SQL à exécuter (bloquant) + CA TLS, sauvegardes, rotation`
- **Pièce jointe** : aucune. Ne jamais joindre un mot de passe, une URL de
  connexion ou un dump.

---

Bonjour,

Merci d'avoir débloqué le port public **33072** : la connexion fonctionne, en
**TLS 1.3** (`TLS_AES_256_GCM_SHA384`), base `devnet`, rôle `devnet_u`,
PostgreSQL 18.3 (Percona Server for PostgreSQL 18.3.1).

Je ne parviens plus à ouvrir la console d'administration de l'instance (la page
affiche « Impossible de charger les ressources du cluster »), donc je ne peux pas
exécuter moi-même l'opération ci-dessous.

**1. Bloquant — quatre lignes à exécuter avec un rôle superutilisateur**

L'inventaire en lecture seule montre que `devnet_u` peut créer des schémas, des
extensions et des publications, mais pas des rôles :

```
42501 — permission denied to create role
```

Notre schéma en a besoin (161 politiques RLS les référencent) :

```sql
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant anon, authenticated, service_role to devnet_u;
```

`bypassrls` ne peut être accordé que par un superutilisateur, d'où ma demande.
La base est **vide** (0 table) : aucune donnée n'est touchée, aucun
redimensionnement, aucun redémarrage. Pouvez-vous exécuter ces lignes, ou nous
fournir un accès ponctuel équivalent (rôle avec `CREATEROLE` et `BYPASSRLS`) ?

**2. Certificat TLS**

La console affichait « Mode SSL : disable », alors que le serveur négocie bien
TLS 1.3. Le certificat présenté est auto-signé (chaîne `pool-postgres-15-ca`),
donc nous restons en `sslmode=require`, chiffré mais **sans vérification de
l'identité du serveur**. Pouvez-vous nous transmettre le certificat d'autorité
(`root.crt`) pour passer en `verify-full` ?

**3. Sauvegardes**

Fréquence, durée de rétention, restauration à un instant donné (PITR),
procédure et délai de restauration. Nous ne pouvons pas considérer la base comme
protégée sans cette information.

**4. Filtrage par adresse IP**

L'accès est ouvert à `0.0.0.0/0`. Quelle est la date de disponibilité du
filtrage, et existe-t-il un autre moyen de restreindre les sources ?

**5. Rotation du mot de passe**

Quelle est la procédure pour renouveler le mot de passe de `devnet_u` ? Le
bouton « Nouvelles informations d'identification » n'apparaît pas dans
l'interface que je vois. **Le mot de passe actuel doit être considéré comme
compromis** : il a circulé par erreur, et nous souhaitons le remplacer dès que
possible.

Merci d'avance pour votre retour.

Cordialement,
Priscille Laudes Marcel MASSAMBA
