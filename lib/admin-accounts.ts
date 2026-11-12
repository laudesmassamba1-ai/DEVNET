/**
 * L'annuaire des comptes et le rôle d'administration.
 *
 * Compagnon de `lib/verification-data.ts`, et même règle : la base décide.
 * Le déclencheur `guard_account_roles` (migration 037) n'autorise
 * l'écriture de `is_admin` que par un compte qui porte déjà `is_admin` —
 * un membre qui appellerait `setAdminRole` est donc refusé par la base,
 * pas par un `if` décoratif de cette page.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne crée pas de compte hors session. En mode réel, une ligne `users`
 * appartient à la session qui la pose (`users_insert with check
 * (auth.uid() = id)`) : un administrateur ne peut pas insérer la ligne de
 * quelqu'un d'autre, et c'est heureux. La création d'un compte passe donc
 * par la route `app/api/admin/accounts`, qui vérifie l'appelant puis
 * travaille avec la clé de service — le seul endroit du projet où une
 * écriture touche la ligne d'un autre avant qu'elle existe.
 *
 * En mode démo, il n'y a pas de route : `createAccount` insère directement
 * dans le store, qui n'a pas de `auth.users` séparé à tenir à jour.
 */
import { api, usingDemoData } from "./api/client";
import { uniquePseudo } from "./api/profile";
import { AVATARS, type AccountType, type AvatarColor } from "./types";
import { asVerificationStatus, type VerificationStatus } from "./verification";

/** Colonnes de l'annuaire : ce qu'un administrateur a besoin de lire. */
const ACCOUNT_FIELDS =
  "id, prenom, pseudo, email, avatar_color, account_type, verified, " +
  "is_admin, verification_status, created_at";

/**
 * Au-delà, l'annuaire n'est plus une liste mais un export.
 *
 * On le plafonne et on **le dit** (`capped`) plutôt que de rendre 300
 * lignes en laissant croire que c'est tout : une recherche qui ne trouve
 * rien dans une liste tronquée est un mensonge par omission.
 */
const LIST_LIMIT = 300;

export interface AdminAccount {
  id: string;
  prenom: string;
  pseudo: string;
  email: string;
  avatar_color: AvatarColor;
  account_type: AccountType;
  verified: boolean;
  is_admin: boolean;
  verification_status: VerificationStatus;
  created_at: string;
}

export interface AccountPage {
  accounts: AdminAccount[];
  /** Vrai quand la liste a été coupée au plafond de lecture. */
  capped: boolean;
}

/** Traduit la ligne brute en compte affichable. */
function toAccount(row: Record<string, unknown>): AdminAccount {
  return {
    id: String(row.id ?? ""),
    prenom: String(row.prenom ?? ""),
    pseudo: String(row.pseudo ?? ""),
    email: String(row.email ?? ""),
    avatar_color: String(row.avatar_color ?? "av-sage") as AvatarColor,
    account_type: String(row.account_type ?? "student") as AccountType,
    verified: Boolean(row.verified),
    is_admin: Boolean(row.is_admin),
    verification_status: asVerificationStatus(row.verification_status),
    created_at: String(row.created_at ?? ""),
  };
}

/**
 * Échappe un terme de recherche pour la syntaxe `or` de PostgREST.
 *
 * La chaîne est passée telle quelle dans la requête : une virgule y
 * séparerait deux clauses, une parenthèse fermerait le groupe. On retire
 * ces caractères au lieu de les encoder — un pseudo ou un email n'en
 * contient pas, et un terme nettoyé cherche trop large, jamais trop peu.
 */
function searchTerm(raw: string): string {
  return raw.trim().replace(/[,()*%\\]/g, "").slice(0, 40);
}

/**
 * L'annuaire, trié pour l'œil : les administrateurs d'abord, puis
 * l'alphabet des pseudos.
 *
 * Le tri est fait ici, pas en base : la démo ne tient qu'une seule colonne
 * d'ordre, et un tri à deux niveaux y divergerait de Postgres sans que ça
 * se voie — sur une liste courte, le désordre est exactement le genre
 * d'écart qu'on ne remarque qu'une fois devant la démo.
 */
export async function fetchAccounts(search = ""): Promise<AccountPage> {
  const term = searchTerm(search);

  // En mode réel, `users.email` n'est plus lisible directement : la
  // fonction `admin_search_accounts` (security definer) rend l'annuaire
  // complet après avoir vérifié `is_admin()`.
  const { data, error } = usingDemoData()
    ? await (() => {
        let query = api
          .from("users")
          .select(ACCOUNT_FIELDS)
          .limit(LIST_LIMIT);
        if (term) {
          query = query.or(
            `pseudo.ilike.%${term}%,prenom.ilike.%${term}%,email.ilike.%${term}%`,
          );
        }
        return query;
      })()
    : await api.rpc("admin_search_accounts", { term });

  if (error) throw error;

  const raw = (data ?? []) as Record<string, unknown>[];
  const accounts = raw.map(toAccount).sort((a, b) => {
    if (a.is_admin !== b.is_admin) return a.is_admin ? -1 : 1;
    return a.pseudo.localeCompare(b.pseudo);
  });

  return { accounts, capped: raw.length >= LIST_LIMIT };
}

/**
 * Nomme un compte administrateur, ou lui retire le rôle.
 *
 * `.select("id")` et le compte de lignes, encore : une politique de ligne
 * ne refuse pas, elle **saute** la ligne. Sans cette lecture, promouvoir
 * quelqu'un hors de portée reviendrait sans erreur avec zéro ligne
 * touchée, et l'écran annoncerait « Nadia est administratrice » sur une
 * base inchangée.
 *
 * `selfId` est un garde-fou de produit, pas de sécurité : un
 * administrateur qui se retire le rôle le fait par erreur, et
 * l'administration se retrouverait sans personne. La base, elle, ne
 * l'empêche pas — c'est à l'écran de refuser ça.
 */
export async function setAdminRole(
  userId: string,
  isAdmin: boolean,
  selfId: string,
): Promise<void> {
  if (userId === selfId && !isAdmin) {
    throw new Error("retire le rôle à quelqu'un d'autre — pas à toi-même");
  }

  const { data, error } = await api
    .from("users")
    .update({ is_admin: isAdmin })
    .eq("id", userId)
    .select("id");

  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(
      `écriture sans effet (${isAdmin ? "promotion" : "retrait du rôle"}) — ` +
        "la base a refusé",
    );
  }
}

export interface NewAccount {
  email: string;
  prenom: string;
  /** Vide → dérivé de l'email, comme le fait `handle_new_user`. */
  pseudo: string;
  password: string;
  account_type: AccountType;
  is_admin: boolean;
}

/** Contrôle de forme avant l'écriture : on refuse ici ce que la base refuserait. */
export function validateNewAccount(input: NewAccount): string | null {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return "adresse email invalide";
  }
  if (!input.prenom.trim()) return "le prénom est requis";
  // Six caractères : c'est le minimum que Supabase Auth applique de son
  // côté. Le vérifier ici donne une phrase utile au lieu d'un refus sec.
  if (input.password.length < 6) return "mot de passe : six caractères au moins";
  return null;
}

/** Identifiant local, faute de `crypto.randomUUID` sur les vieux navigateurs. */
function localId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Crée un compte, et lui donne le rôle d'administration si demandé.
 *
 * Deux chemins, une seule porte :
 *
 *  - **mode réel** : la route `/api/admin/accounts`, parce que la ligne
 *    `users` d'un tiers ne peut pas être écrite depuis la session de
 *    l'administrateur. La route relit ensuite la ligne créée ;
 *  - **mode démo** : l'insertion directe dans le store, équivalent de ce
 *    que la route fait avec la clé de service.
 *
 * Ce qui est **commun** aux deux, c'est la relecture : on ne devine pas la
 * ligne créée, on la relit depuis la base. Un compte dont on inventerait
 * le contenu à l'écran serait un compte qu'on ne verrait qu'à moitié.
 */
export async function createAccount(
  input: NewAccount,
): Promise<{ error: string | null }> {
  const invalid = validateNewAccount(input);
  if (invalid) return { error: invalid };

  const email = input.email.trim().toLowerCase();

  // L'unicité de l'adresse est garantie par `auth.users` en mode réel
  // (d'où le 409 de la route) : `public.users` n'a pas de contrainte
  // dessus. On la vérifie donc ici, pour que la démo et le mode réel
  // répondent la même chose — un doublon créé en démo serait un compte
  // qui n'existerait pas en production.
  const { data: clash } = await api
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (clash) return { error: "un compte existe déjà avec cette adresse" };

  if (!usingDemoData()) {
    const res = await fetch("/api/admin/accounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });

    if (res.ok) return { error: null };

    const payload = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    return { error: payload?.error ?? `création impossible (${res.status})` };
  }

  const pseudo = await uniquePseudo(input.pseudo.trim() || input.prenom);

  const row = {
    id: localId(),
    prenom: input.prenom.trim(),
    pseudo,
    email: input.email.trim().toLowerCase(),
    filiere: "",
    niveau: "",
    langages: [] as string[],
    avatar_color: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    bio: "",
    ville: "",
    pays: "",
    account_type: input.account_type,
    verified: input.is_admin,
    is_admin: input.is_admin,
    verification_status: input.is_admin ? "acceptee" : "none",
    followers: 0,
    following: 0,
    created_at: new Date().toISOString(),
    // Le mot de passe n'est écrit **qu'en démo**, et en clair : il n'y a
    // pas d'`auth.users` pour le hacher ici. C'est ce qui permet à la
    // démo de vérifier vraiment une connexion créée depuis cet écran
    // (`lib/demo/client.ts`) au lieu de l'accepter avec n'importe quoi.
    // En mode réel, le mot de passe ne quitte jamais la route serveur.
    password: input.password,
  };

  const { data, error } = await api
    .from("users")
    .insert(row)
    .select(ACCOUNT_FIELDS);

  if (error) return { error: error.message ?? "création impossible" };
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "création sans effet — la base n'a rien renvoyé" };
  }
  return { error: null };
}
