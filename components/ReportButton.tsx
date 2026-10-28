"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { reportTarget, REASONS } from "@/lib/reports";
import type { ReportReason, ReportTarget } from "@/lib/types";

/**
 * Le bouton **Signaler**, et la feuille qui l'accompagne.
 *
 * Un signalement se fait en deux temps : d'abord choisir **pourquoi**,
 * puis l'envoyer. On pourrait faire tenir le tout dans un menu — mais
 * un motif choisi à la hâte n'apprend rien à personne, alors qu'un
 * motif absent non plus. La feuille s'ouvre donc sur la liste des motifs,
 * et le champ libre n'apparaît que si le motif est « Autre ».
 *
 * **On ne signale pas son propre contenu.** Le bouton ne s'affiche pas
 * dans ce cas : la RLS refuserait l'envoi, donc l'afficher reviendrait à
 * proposer une action qui échoue — le défaut que la Vague 1 a corrigé sur
 * le bouton Suivre, et qu'il ne faut pas réintroduire ailleurs.
 */
export function ReportButton({
  me,
  targetId,
  targetType,
  targetLabel,
  /** Identifiant de l'auteur de la cible — pour ne pas s'auto-signaler. */
  targetAuthorId,
  compact = false,
  className = "",
}: {
  me: string | null;
  targetId: string;
  targetType: ReportTarget;
  /** Ce que l'écran nommera dans la feuille : « cette publication ». */
  targetLabel: string;
  targetAuthorId?: string | null;
  /** Icône seule : pour une barre d'actions déjà chargée. */
  compact?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  // Ni soi, ni personne : un signalement sur son propre contenu serait
  // refusé par la base et n'aurait aucun sens.
  if (!me || me === targetAuthorId) return null;

  async function submit() {
    if (!me || !reason || busy) return;

    setBusy(true);
    const { error, duplicate } = await reportTarget(me, {
      type: targetType,
      id: targetId,
    }, reason, details);
    setBusy(false);

    if (error) {
      // On ne montre pas le message de Postgres : une violation de RLS
      // n'est pas une information utile pour la personne qui signale.
      // Le journal du navigateur garde la trace technique.
      console.error("[reports] signalement refusé :", error);
      toast("Signalement impossible", "err");
      return;
    }

    setOpen(false);
    setReason(null);
    setDetails("");
    // Un doublon n'est pas un échec : la ligne existe déjà, donc le
    // résultat pour la personne est le même.
    toast(duplicate ? "Déjà signalé" : "Signalement envoyé");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Signaler ${targetLabel}`}
        title={`Signaler ${targetLabel}`}
        className={className}
      >
        <Icon name="flag" size={compact ? 14 : 12} />
        {compact || "signaler"}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Signaler">
        <div className="px-(--gutter) pb-2">
          <p className="mb-3 font-mono text-[11.5px] leading-relaxed text-chalk-4">
            Transmis à son auteur — votre identité reste inconnue.
          </p>

          {/* Un groupe de **choix mutuellement exclusifs**.
              C'est un `radiogroup`, pas une suite de boutons à
              `aria-pressed` : la sémantique n'est pas la même. Des
              boutons à bascule annoncent « bouton, pressé » et
              n'annoncent ni le nombre d'options ni le fait qu'une
              seule réponse est attendue ; un lecteur d'écran laisse
              croire que les cinq motifs sont cochables ensemble. Le
              clavier va plus loin : avec des boutons, les flèches ne
              déplacent rien et il faut tabuler cinq fois pour changer
              d'avis — alors qu'une flèche suffit.

              Le `role="radio"` est posé sur le bouton lui-même : un
             `input` natif serait plus simple, mais il ne rendrait ni
             l'explication sous le libellé, ni la pastille d'accent —
             et il imposerait son propre rendu. */}
          <div
            role="radiogroup"
            aria-label="Motif du signalement"
            className="flex flex-col gap-1.5"
          >
            {REASONS.map((r) => {
              const chosen = reason === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  tabIndex={chosen || reason === null ? 0 : -1}
                  onClick={() => setReason(r.value)}
                  onKeyDown={(e) => {
                    // Les flèches haut/bas déplacent le choix, comme
                    // dans n'importe quel groupe de boutons radio.
                    // Sans cela, le groupe est announced comme radio
                    // mais ne se comporte pas comme un.
                    const i = REASONS.findIndex((x) => x.value === r.value);
                    const suivant =
                      e.key === "ArrowDown"
                        ? (i + 1) % REASONS.length
                        : e.key === "ArrowUp"
                          ? (i - 1 + REASONS.length) % REASONS.length
                          : null;
                    if (suivant === null) return;
                    e.preventDefault();
                    setReason(REASONS[suivant].value);
                    // Le focus suit la sélection : sans ça, le clavier
                    // est sur cette ligne tandis que la sélection est
                    // ailleurs, et l'utilisateur ne sait plus où il
                    // se trouve.
                    const groupe = e.currentTarget.parentElement;
                    groupe?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                      [suivant]?.focus();
                  }}
                  className={`flex items-center gap-2.5 rounded-[var(--radius-input)]
                    border px-3 py-2.5 text-left transition-[background-color,color,border-color]
                    duration-[var(--d-fast)] ${chosen
                      ? "border-signal bg-signal/10 text-chalk"
                      : "border-line-2 bg-surface text-chalk-2 hover:border-line-3"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-[18px] shrink-0 place-items-center rounded-full
                      border ${chosen ? "border-signal bg-signal text-void" : "border-line-3"}`}
                  >
                    {chosen && <Icon name="check" size={9} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold">{r.label}</span>
                    <span className="block font-mono text-[11px] text-chalk-4">{r.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Le récit n'a de sens qu'avec un motif « autre » : ailleurs,
              il ferait doublonner la case à cocher. */}
          {reason === "other" && (
            <div className="mt-3">
              <label className="label-micro mb-1.5 block text-chalk-4" htmlFor="report-details">
                Ce qu&apos;il faut savoir
              </label>
              <textarea
                id="report-details"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ce que tu as vu, sans interprétation."
                className="w-full resize-none border border-line-2 bg-surface px-2.5 py-2
                  text-[13px] leading-relaxed text-chalk outline-none transition-colors
                  duration-[var(--d-fast)] placeholder:text-chalk-4/60 focus:border-signal"
              />
              <p className="mt-1 text-right font-mono text-[10.5px] text-chalk-4 tnum">
                {details.length}/1000
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={!reason || busy}
            className="mo-press mt-4 inline-flex h-[var(--h-tap)] w-full items-center
              justify-center gap-2 rounded-[var(--radius-input)] border border-signal
              bg-signal px-4 font-mono text-[12px] font-bold uppercase
              tracking-[0.12em] text-void disabled:opacity-40"
          >
            <Icon name="flag" size={14} strokeWidth={2} />
            envoyer
          </button>
        </div>
      </Sheet>
    </>
  );
}