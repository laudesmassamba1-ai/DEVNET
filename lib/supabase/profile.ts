import { supabase } from "./client";
import { AVATARS, type AvatarColor, type ProfileLink, type User } from "../types";

/** Champs du profil qu'un utilisateur peut modifier lui-même. */
export interface ProfilePatch {
  prenom?: string;
  bio?: string;
  filiere?: string;
  niveau?: string;
  ville?: string;
  pays?: string;
  langages?: string[];
  avatar_color?: AvatarColor;
  theme?: string;
  links?: ProfileLink[];
}

/** Récupère le profil, ou null. */
export async function getProfile(userId: string): Promise<User | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) return null;
  return data as User;
}

/**
 * Enregistre les champs personnalisables de son propre profil.
 *
 * On passe par une fonction unique plutôt que par un `update` écrit dans la
 * page : c'est le seul endroit qui décide **ce qui est modifiable**. Le
 * pseudo et le type de compte n'y sont pas : le premier est l'identité
 * publique (URL, mentions), le second est un état de compte qui a sa propre
 * bascule. Les laisser passer par ici les rendrait modifiables par accident,
 * depuis n'importe quel écran qui dispose du patch.
 *
 * `.select("id")` n'est pas décoratif : sans lui, PostgREST ne rend aucune
 * ligne et `error` reste `null` même quand la politique de ligne a écarté
 * la ligne visée — l'écran dirait alors « Enregistré » sur une écriture qui
 * n'a rien touché. On compte donc les lignes rendues, comme dans
 * `lib/verification-data.ts`.
 */
export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<{ error: Error | null }> {
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("id");

  if (error) return { error };
  if (!Array.isArray(data) || data.length === 0) {
    return { error: new Error("aucune ligne modifiée — profil hors de portée") };
  }
  return { error: null };
}

/**
 * Découpe un pseudo pour le rendre unique : koffi → koffi1 → koffi2…
 *
 * Exporté parce que la création d'un compte par l'administration en a
 * besoin aussi : la base dérive le pseudo pour une inscription
 * (`handle_new_user`), mais en mode démo il n'y a pas de déclencheur pour
 * le faire, et l'écran doit montrer le même pseudo que celui qui sera
 * réellement écrit.
 *
 * On **passe en minuscules** avant de nettoyer, comme le fait le
 * déclencheur (`lower(regexp_replace(...))`). Sans ça, le filtre
 * `[^a-z0-9_]` ne retirait pas les majuscules : « Fatou » devenait
 * « atou », un pseudo amputé de sa première lettre.
 */
export async function uniquePseudo(base: string): Promise<string> {
  const root = base.toLowerCase().replace(/[^a-z0-9_]/g, "") || "dev";

  for (let n = 0; n < 25; n += 1) {
    const candidate = n === 0 ? root : `${root}${n}`;
    const { data } = await supabase
      .from("users")
      .select("id")
      .eq("pseudo", candidate)
      .maybeSingle();

    if (!data) return candidate;
  }
  return `${root}${Date.now().toString().slice(-5)}`;
}

/**
 * Récupère le profil, ou le crée si absent.
 *
 * Le trigger `handle_new_user()` crée normalement la ligne à l'inscription.
 * Ce filet couvre les cas où le trigger n'a pas tourné (inscription
 * antérieure au trigger, import manuel, compte créé via l'admin API).
 */
export async function getOrCreateProfile(
  authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> },
): Promise<{ profile: User | null; error: Error | null }> {
  const existing = await getProfile(authUser.id);
  if (existing) return { profile: existing, error: null };

  const meta = authUser.user_metadata ?? {};
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string).trim() : "");

  const prenom = str("prenom") || (authUser.email ?? "").split("@")[0] || "Dev";
  const pseudo = await uniquePseudo(str("pseudo") || prenom);
  const langages = Array.isArray(meta.langages)
    ? (meta.langages as string[])
    : [];

  const row = {
    id: authUser.id,
    prenom,
    pseudo,
    email: authUser.email ?? "",
    filiere: str("filiere"),
    niveau: str("niveau"),
    langages,
    avatar_color: (str("avatar_color") ||
      AVATARS[Math.floor(Math.random() * AVATARS.length)]) as AvatarColor,
    bio: "",
    account_type: "student" as const,
    verified: false,
  };

  const { data, error } = await supabase
    .from("users")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  return { profile: (data as User) ?? null, error: error ?? null };
}