/**
 * Contenu d'exemple.
 *
 * Un backend neuf est vide : un compte créé, zéro post, zéro groupe. C'est
 * l'état réel de tout projet neuf, et c'est aussi le pire état pour juger
 * une application — on ne voit ni le fil, ni la carte d'activité, ni les
 * stories.
 *
 * Plutôt que de demander une graine SQL à exécuter manuellement (donc rien
 * ne se passe), on **génère le contenu depuis l'application elle-même**.
 * C'est possible parce que la RLS autorise un utilisateur à insérer ses
 * propres lignes : `auth.uid() = author_id`. On n'écrit donc que ce que
 * l'utilisateur pourrait écrire lui-même — ce qui rend l'action honnête,
 * réversible, et fonctionnelle sans privilège particulier.
 *
 * Chaque publication est marquée d'un préfixe (`[exemple]`) pour qu'on
 * puisse les retirer d'un coup.
 */

import { supabase } from "@/lib/supabase/client";
import type { User } from "@/lib/types";

const MARK = "[exemple]";

interface Sample {
  text: string;
  has_code: boolean;
  code?: string;
  lang?: string;
  /** Jours avant aujourd'hui. */
  ago: number;
  /** Nombre de likes simulés, pour gonfler la carte d'activité. */
  likes: number;
}

const SAMPLES: Sample[] = [
  {
    text: `${MARK} Le bug le plus coûteux que j'aie jamais eu : un \`<div>\` non fermé. Le navigateur-console disait « nothing ». Pas une erreur, pas un warning — rien. Trois heures.`,
    has_code: false,
    ago: 9,
    likes: 34,
  },
  {
    text: `${MARK} Normalisez **avant** de découper en jeu d'entraînement / test. J'ai passé un semestre à m'étonner que mes scores soient trop beaux.`,
    has_code: true,
    lang: "Python",
    code: `from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

scaler = StandardScaler()
X = scaler.fit_transform(X)          # avant le split, pas après

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)`,
    ago: 6,
    likes: 51,
  },
  {
    text: `${MARK} Rappel que \`String(v)\` n'est pas une validation. \`String([])\` donne \`""\` et \`String([1,2])\` donne \`"1,2"\`. Votre API adore ça.`,
    has_code: true,
    lang: "JavaScript",
    code: `// ce que font beaucoup de gens
if (String(id)) checkUser(id);

// la validation explicite
if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
  throw new ValidationError('id invalide');
}`,
    ago: 3,
    likes: 78,
  },
  {
    text: `${MARK} Postmortem court : notre service est tombé 40 minutes à cause d'une migration qui holdingait une table. Bilan : toujours un rollback écrit **avant**.`,
    has_code: false,
    ago: 2,
    likes: 46,
  },
  {
    text: `${MARK} Tip SQL : \`DISTINCT ON\` évite trois \`GROUP BY\` imbriqués pour garder la dernière ligne par entité. Postgres 9.4+.`,
    has_code: true,
    lang: "SQL",
    code: `SELECT DISTINCT ON (user_id) *
FROM sessions
ORDER BY user_id, created_at DESC;`,
    ago: 1,
    likes: 22,
  },
];

/**
 * Publie les exemples comme l'utilisateur courant.
 *
 * `created_at` est forcé dans le passé pour que la carte d'activité et la
 * série aient quelque chose à montrer : un backend neuf, c'est aussi un
 * historique vide.
 */
export async function seedSamplePosts(profile: User): Promise<number> {
  const rows = SAMPLES.map((s) => ({
    author_id: profile.id,
    // Pas de recopie de l'auteur : le fil lit `author:users(...)`.
    // Voir `Post` dans `lib/types.ts` — ces colonnes sont des reliques.
    text: s.text,
    has_code: s.has_code,
    code: s.code ?? "",
    lang: s.has_code ? (s.lang ?? "") : "",
    likes: s.likes,
    liked_by: [],
    comments: 0,
    created_at: new Date(Date.now() - s.ago * 86_400_000).toISOString(),
  }));

  const { data, error } = await supabase.from("posts").insert(rows).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Retire les exemples publiés par ce compte. */
export async function removeSamplePosts(profile: User): Promise<number> {
  const { data, error } = await supabase
    .from("posts")
    .delete()
    .eq("author_id", profile.id)
    .like("text", `${MARK}%`)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** Le compte possède-t-il encore des exemples ? */
export async function hasSamplePosts(profile: User): Promise<boolean> {
  const { data, error } = await supabase
    .from("posts")
    .select("id")
    .eq("author_id", profile.id)
    .like("text", `${MARK}%`)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export const SAMPLE_MARK = MARK;
