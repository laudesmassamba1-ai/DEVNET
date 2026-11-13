"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { isFollowing, toggleFollow } from "@/lib/social";

/**
 * Le bouton **Suivre**, seul endroit du code où l'on écrit dans `follows`.
 *
 * Il est utilisé à deux endroits — l'en-tête d'un profil et chaque ligne
 * d'une liste d'abonnés — donc l'état, l'attente et l'erreur vivent ici
 * plutôt que d'être réécrits deux fois. Deux copies d'un bouton de suivi
 * finissent toujours par diverger : l'une afficherait « Abonné » et
 * l'autre « Suivi », et on ne saurait plus laquelle ment.
 *
 * ** Le compteur n'est pas recalculé ici.** `toggleFollow` renvoie l'état
 * du lien, et le parent ajuste son propre nombre : c'est le cache écrit
 * par le déclencheur qui fait foi, mais le parent n'a pas à le relire
 * pour peindre un `+1` juste après le clic.
 */
export function FollowButton({
  me,
  targetId,
  targetPseudo,
  /** État déjà connu du parent — évite une requête au montage. */
  defaultFollowing,
  /** `compact` dans une liste, `full` sur un en-tête de profil. */
  variant = "full",
  onChanged,
}: {
  me: string | null;
  targetId: string;
  targetPseudo: string;
  defaultFollowing?: boolean;
  variant?: "full" | "compact";
  /**
   * Le lien a changé d'état.
   *
   * L'état **précédent** est passé avec : sans lui, le parent ne peut pas
   * ajuster un compteur quand il ne connaissait pas l'ancien état (le
   * profil qui charge encore). Il peut alors ignorer l'appel — son
   * chiffre vient déjà du serveur.
   */
  onChanged?: (following: boolean, previous: boolean | undefined) => void;
}) {
  const toast = useToast();

  // `undefined` = on ne sait pas encore. La distinction compte : sans
  // elle, le bouton s'afficherait « suivre » pendant la requête, puis
  // clignoterait en « suivi » sur un profil où l'on suivait déjà.
  const [following, setFollowing] = useState<boolean | undefined>(defaultFollowing);
  const [busy, setBusy] = useState(false);

  // Quand le parent apprend enfin la réponse — le profil finit de
  // charger — elle doit remplacer l'inconnu, sinon le bouton resterait
  // bloqué sur « suivre » alors que le lien existe. On ajuste pendant le
  // rendu plutôt que dans un effet : c'est la manière recommandée par
  // React pour cet état dérivé d'une prop, et surtout la seule qui
  // n'entraîne pas un rendu intermédiaire avec la mauvaise étiquette.
  const [known, setKnown] = useState(defaultFollowing);
  if (defaultFollowing !== undefined && defaultFollowing !== known) {
    setKnown(defaultFollowing);
    setFollowing(defaultFollowing);
  }
  // Le parent qui **oublie** l'état (session en cours de chargement) ne
  // doit pas effacer ce qu'on sait déjà : un `undefined` signifie « je ne
  // sais plus », pas « je ne suis plus ». Le bouton garde donc sa valeur
  // et ne revient pas à « suivre » sous le doigt.
  if (defaultFollowing === undefined && known !== undefined) {
    setKnown(undefined);
  }

  // Sans état connu, on le demande — sauf pour les liens dont on sait
  // qu'ils ne peuvent pas exister (soi-même, ou pas de session).
  useEffect(() => {
    if (defaultFollowing !== undefined || !me || me === targetId) return;

    let alive = true;
    void isFollowing(me, targetId).then((value) => {
      if (alive) setFollowing(value);
    });

    return () => {
      alive = false;
    };
  }, [defaultFollowing, me, targetId]);

  if (!me) return null;

  async function onClick() {
    if (busy || !me || me === targetId) return;

    // Tant que l'état est inconnu, on ne triche pas : une bascule
    // « optimised » depuis l'inconnu ferait mentir le parent sur un
    // compteur dont il ignore la base. On applique donc le résultat de la
    // base, et c'est lui qui décide s'il doit corriger son chiffre.
    if (following === undefined) {
      setBusy(true);
      const { following: real, error } = await toggleFollow(me, targetId);
      setBusy(false);

      if (error) {
        toast("Suivi impossible", "err");
        return;
      }
      setFollowing(real);
      onChanged?.(real, undefined);
      return;
    }

    // Optimiste : la bascule est un geste, pas une requête. On annule si
    // la base refuse, ce qui évite l'aller-retour réseau dans le cas
    // courant — et le cas courant, c'est celui qui marche.
    const next = !following;
    setFollowing(next);
    onChanged?.(next, following);
    setBusy(true);

    const { following: real, error } = await toggleFollow(me, targetId);
    setBusy(false);

    if (error) {
      setFollowing(following);
      onChanged?.(following, next);
      toast("Suivi impossible", "err");
      return;
    }

    // La base peut répondre autre chose que ce qu'on a annoncé — le lien
    // a pu être créé entre-temps depuis un autre poste. On ne corrige
    // que dans ce cas précis.
    //
    // La comparaison se fait avec `next` (ce qu'on vient d'annoncer) et
    // **non** avec la valeur d'avant le clic : `next` est par construction
    // toujours différent de celle-là, donc comparer à l'ancienne valeur
    // déclencherait une seconde notification — et le parent, qui ajuste un
    // compteur par différence, retrancherait deux fois d'un coup.
    if (real !== next) {
      setFollowing(real);
      onChanged?.(real, next);
    }
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-pressed={following}
        aria-label={
          following ? `Ne plus suivre ${targetPseudo}` : `Suivre ${targetPseudo}`
        }
        className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-[var(--radius-input)]
          border px-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em]
          transition-[background-color,color,border-color] duration-[var(--d-fast)]
          disabled:opacity-50
          ${following
            ? "border-line-3 bg-surface-2 text-chalk-3 hover:border-danger hover:text-danger"
            : "border-signal bg-signal text-void"}`}
      >
        <Icon name={following ? "check" : "follow"} size={12} strokeWidth={2} />
        {following ? "suivi" : "suivre"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={following}
      // Le texte visible ne dit que « suivi » : sans nom explicite, un
      // lecteur d'écran annonce « suivi, bouton » sans savoir de qui,
      // alors que la page peut en contenir plusieurs.
      aria-label={
        following ? `Ne plus suivre ${targetPseudo}` : `Suivre ${targetPseudo}`
      }
      className={`inline-flex h-[var(--h-tap)] flex-1 items-center justify-center
        gap-1.5 rounded-[var(--radius-input)] border font-mono text-[12px]
        font-bold tracking-[0.12em] uppercase
        transition-[background-color,color,border-color,transform]
        duration-[var(--d-fast)] active:translate-y-px disabled:opacity-50
        ${following
          ? "border-line-3 bg-surface-2 text-chalk-2 hover:border-danger hover:text-danger"
          : "border-signal bg-signal text-void shadow-[var(--shadow-action)] hover:border-signal hover:shadow-[var(--shadow-lift-2)]"}`}
    >
      <Icon name={following ? "check" : "follow"} size={14} strokeWidth={2} />
      {following ? "suivi" : "suivre"}
    </button>
  );
}