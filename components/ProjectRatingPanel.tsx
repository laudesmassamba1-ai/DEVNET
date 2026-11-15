"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import type { Project, User } from "@/lib/types";
import { castRating, fetchMyVote, fetchRating } from "@/lib/rating-data";
import { forkProject } from "@/lib/fork";
import type { RatingResult } from "@/lib/rating";

/**
 * Noter un projet, et le forker.
 *
 * ## La notation
 *
 * Cinq étoiles, en vif : un clic pose le vote, le re-clic le déplace.
 * La note affichée **n'est jamais la moyenne brute** : c'est la note
 * bayésienne du moteur (`fetchRating` → `rateProject`), resserée vers
 * la moyenne de la plateforme tant que l'échantillon est petit. Afficher
 * autre chose reviendrait à classer en tête les projets les moins
 * évalués — le défaut classique que le moteur existe pour corriger.
 *
 * Le votant n'a pas besoin de lire « bayésien » : la ligne « n votes »
 * dit la taille du jury, et c'est la seule的信息 qu'il faut pour
 * juger la fermeté de la note.
 *
 * ## Le fork
 *
 * Le bouton crée un projet neuf, copie les fichiers de la branche
 * affichée, enregistre la parenté, et navigue vers le nouveau dépôt.
 * Une fois ouverte, l'écran du fork montre l'arbre complet : c'est la
 * seule preuve visuelle qui compte.
 */
export function ProjectRatingPanel({
  project,
  branch,
  me,
  isOwner,
}: {
  project: Project;
  /** Branche affichée : celle qu'on fork, pas forcément `main`. */
  branch: string;
  me: User | null;
  /** Un fork de son propre dépôt est possible, mais marqué comme tel. */
  isOwner: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [rating, setRating] = useState<RatingResult | null>(null);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [forking, setForking] = useState(false);

  const reload = useCallback(async () => {
    const [r, v] = await Promise.all([
      fetchRating(project.id),
      me ? fetchMyVote(project.id, me.id) : Promise.resolve(null),
    ]);
    setRating(r);
    setMyVote(v);
  }, [project.id, me]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [r, v] = await Promise.all([
        fetchRating(project.id),
        me ? fetchMyVote(project.id, me.id) : Promise.resolve(null),
      ]);
      if (!mounted) return;
      setRating(r);
      setMyVote(v);
    })();
    return () => {
      mounted = false;
    };
  }, [project.id, me]);

  async function vote(stars: number) {
    if (!me || busy) return;
    setBusy(true);
    const res = await castRating({
      projectId: project.id,
      voterId: me.id,
      voterLang: (project.language || me.langages?.[0] || "") as string,
      stars,
    });
    if (res.reason === "deja") {
      toast("Vous avez déjà noté ce projet.");
    } else if (res.reason === "erreur") {
      toast("La note n'a pas pu être enregistrée.");
    } else if (res.reason === "invalide") {
      toast("Note invalide.");
    }
    await reload();
    setBusy(false);
  }

  async function doFork() {
    if (!me || forking) return;
    setForking(true);
    const { project: forked, error } = await forkProject({
      source: project,
      branch,
      owner: { id: me.id, prenom: me.prenom, email: me.email },
    });
    if (error || !forked) {
      toast(error ?? "Le fork n'a pas pu être créé.");
      setForking(false);
      return;
    }
    toast(`Fork créé — ${forked.name}`);
    router.push(`/projects/${forked.id}`);
  }

  const note = rating?.votes ? rating.stars.toFixed(1) : "—";

  return (
    <section className="rounded-(--radius-card) border border-line-2 bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="star" size={14} className="shrink-0 text-signal" />
          <span className="tnum text-15 font-bold text-chalk">{note}</span>
          <span className="text-12 text-chalk-3">
            {rating?.votes
              ? `${rating.votes} vote${rating.votes > 1 ? "s" : ""}`
              : "pas encore noté"}
          </span>
          {me && (
            <span className="ml-1 flex gap-0.5" role="radiogroup" aria-label="Noter de 1 à 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  type="button"
                  aria-checked={myVote === n}
                  disabled={busy}
                  onClick={() => void vote(n)}
                  className={`mo-press flex size-(--h-tap) items-center justify-center rounded-(--radius-chip) transition-colors
                    ${myVote !== null && n <= (myVote ?? 0) ? "text-signal" : "text-chalk-4 hover:text-chalk-2"}`
                  }
                  title={myVote === n ? `Votre note : ${n}` : `Noter ${n}/5`}
                >
                  <Icon name="star" size={14} strokeWidth={myVote === n ? 2.2 : 1.6} />
                </button>
              ))}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void doFork()}
          disabled={forking || !me}
          className="mo-press ml-auto inline-flex items-center gap-1.5 rounded-(--radius-chip)
            border border-signal bg-signal/10 px-3 py-2 font-mono text-12 font-bold
            uppercase tracking-[0.12em] text-signal transition-colors
            disabled:opacity-40"
          title={isOwner ? "Forker votre propre projet" : `Forker ${project.name} (branche ${branch})`}
        >
          {forking ? (
            <span className="flex items-center gap-2">
              <Icon name="command" size={12} strokeWidth={2} />
              fork en cours…
            </span>
          ) : (
            <>
              <Icon name="fork" size={12} strokeWidth={2.2} />
              {isOwner ? "self-fork" : "fork"}
            </>
          )}
        </button>
      </div>

    </section>
  );
}
