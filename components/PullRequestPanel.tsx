"use client";

import { useCallback, useEffect, useState } from "react";

import { EmptyState, Loading } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Motion } from "@/components/Motion";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import type { FileDiff } from "@/lib/git/history";
import type { Verdict } from "@/lib/git/pull";
import {
  createPullRequest,
  fetchPullRequestDiff,
  fetchPullRequests,
  judgePullRequest,
  mergePullRequest,
  setPullRequestStatus,
  type PullRequest,
} from "@/lib/pull";
import { timeAgo } from "@/lib/utils";

/**
 * Les demandes d'intégration d'un dépôt.
 *
 * ## Ce que cet écran promet, et ce qu'il ne promet pas
 *
 * Il promet trois choses, et il les promet toutes :
 *
 * - **le diff est celui de la branche**, pas la différence entre les
 *   deux branches. Une demande montre ce que la branche apporte depuis
 *   son point de départ ; l'autre comparaison afficherait comme
 *   suppressions le travail fait sur la destination, que la branche n'a
 *   rien retiré ;
 * - **le bouton « Fusionner » n'apparaît que si la fusion est possible**,
 *   et la phrase dit pourquoi elle ne l'est pas. Un bouton qui échoue
 *   apprend à ne pas l'être ;
 * - **la fusion est un acte**, avec une confirmation et un commit
 *   nommé. Il n'y a pas de fusion automatique : `lib/git/history.ts`
 *   l'explique, et c'est la seule décision qui ne perd pas de travail en
 *   silence.
 *
 * ## Pourquoi les diffs sont chargés avec la liste
 *
 * Chaque ligne affiche « 3 fichiers +18 −4 », comme partout ailleurs. Le
 * coût est une lecture par demande, et le panneau **n'est monté que
 * lorsque l'onglet est ouvert** : un dépôt qu'on ouvre pour lire du code
 * ne paie rien. Charger le diff au dépliage paraît plus fin, et
 * afficherait une liste sans nombres — donc sans aucune information sur
 * l'ampleur du travail à relire.
 */

interface Props {
  projectId: string;
  /** Branches du dépôt, pour la feuille d'ouverture. */
  branches: string[];
  /** La branche affichée par l'écran — celle d'où part la demande. */
  brancheCourante: string;
  /** La branche d'intégration par défaut. */
  brancheParDefaut: string;
  /** La demande vient d'être ouverte ou fusionnée : l'onglet doit suivre. */
  onChange?: () => void;
}

interface Ligne {
  pull: PullRequest;
  diff: FileDiff[];
  verdict: Verdict | null;
  /**
   * La branche de départ n'existe plus.
   *
   * C'est le cas ordinaire d'une demande intégrée : la branche est
   * supprimée une fois son travail arrivé à destination. Sans cette
   * marque, l'écran comparerait la base à une branche **vide** et
   * afficherait « 4 fichiers −42 » — c'est-à-dire une demande qui
   * aurait supprimé tout le dépôt. C'est un mensonge
   * silencieux, produit par un calcul exact : la comparaison est juste,
   * la question est fausse.
   */
  brancheAbsente: boolean;
}

export function PullRequestPanel({
  projectId,
  branches,
  brancheCourante,
  brancheParDefaut,
  onChange,
}: Props) {
  const { profile } = useSession();
  const toast = useToast();

  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [composant, setComposant] = useState(false);
  const [titre, setTitre] = useState("");
  const [message, setMessage] = useState("");
  const [occupé, setOccupé] = useState(false);

  /**
   * Ce que la branche courante apporte à la destination.
   *
   * Il est lu à l'ouverture de la feuille, et il sert à **refuser** une
   * demande vide : ouvrir une demande depuis une branche qui n'a rien
   * changé produit un écran « aucun changement » — une demande qui ne
   * demande rien et ne peut rien intégrer. Le refus est ici plutôt qu'à
   * la création, parce que c'est au moment de proposer qu'on sait si on
   * a oublié d'enregistrer.
   */
  const [apport, setApport] = useState<FileDiff[] | null>(null);

  /* La lecture des demandes, sans état : les deux appelants (l'effet
     de montage et le rechargement des actions) partagent ce chemin. */
  const buildRows = useCallback(
    async (pid: string, brs: string[]) => {
      const demandes = await fetchPullRequests(pid);

      return Promise.all(
        demandes.map(async (pull) => {
          const brancheAbsente = !brs.includes(pull.source_branch);

          if (brancheAbsente) {
            return { pull, diff: [], verdict: null, brancheAbsente: true };
          }

          return {
            pull,
            diff: await fetchPullRequestDiff(pid, pull),
            verdict:
              pull.status === "ouverte"
                ? await judgePullRequest(pid, pull)
                : null,
            brancheAbsente: false,
          };
        }),
      );
    },
    [],
  );

  const load = useCallback(async () => {
    setLignes(await buildRows(projectId, branches));
  }, [buildRows, projectId, branches]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await buildRows(projectId, branches);
      if (alive) setLignes(rows);
    })();
    return () => {
      alive = false;
    };
  }, [buildRows, projectId, branches]);

  /**
   * Ouvrir la feuille, c'est d'abord savoir si elle a un sens.
   *
   * La lecture est celle du diff d'une demande — base, puis branche — et
   * non la comparaison des deux branches : c'est exactement ce que le
   * lecteur verra dans la demande, donc ce qu'il propose.
   */
  async function ouvrirFeuille() {
    setComposant(true);
    setApport(null);

    setApport(
      await fetchPullRequestDiff(projectId, {
        source_branch: brancheCourante,
        target_branch: brancheParDefaut,
      }),
    );
  }

  async function soumettre() {
    if (!profile || titre.trim().length < 3) return;

    setOccupé(true);
    const { pull, error } = await createPullRequest({
      projectId,
      authorId: profile.id,
      sourceBranch: brancheCourante,
      targetBranch: brancheParDefaut,
      title: titre,
      body: message,
    });
    setOccupé(false);

    if (error) return toast(error, "err");

    setComposant(false);
    setTitre("");
    setMessage("");

    await load();
    onChange?.();

    // La demande s'ouvre : on vient de la créer, on veut la relire.
    if (pull) setOuverte(pull.id);

    toast(`Demande #${pull?.number} ouverte depuis « ${brancheCourante} »`);
  }

  async function fusionner(pull: PullRequest) {
    if (!profile) return;

    setOccupé(true);
    const { commit, verdict, error } = await mergePullRequest({
      projectId,
      pull,
      author: {
        id: profile.id,
        prenom: profile.prenom,
        email: profile.email,
      },
    });
    setOccupé(false);

    if (error || !commit) {
      // Le verdict est renvoyé même en cas d'échec : c'est lui qui
      // explique. Afficher « échec » sans dire lequel serait laisser
      // l'utilisateur deviner.
      return toast(error ?? verdict.raison, "err");
    }

    await load();
    onChange?.();
    toast(`Fusion de #${pull.number} intégrée à « ${pull.target_branch} »`);
  }

  async function fermer(pull: PullRequest) {
    setOccupé(true);
    const { error } = await setPullRequestStatus(pull.id, "fermee");
    setOccupé(false);

    if (error) return toast(error, "err");

    await load();
    onChange?.();
    toast(`Demande #${pull.number} fermée`);
  }

  /* ── Aucune demande ─────────────────────────────────────────── */

  if (lignes?.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Icon name="branch" size={20} strokeWidth={1.5} />}
          title="Aucune demande"
          action={
            <button
              type="button"
              onClick={() => void ouvrirFeuille()}
              className="mo-press inline-flex h-[var(--h-tap)] items-center gap-2
                rounded-[var(--radius-input)] border border-signal bg-signal
                px-4 text-[13px] font-bold text-void shadow-sh-2"
            >
              <Icon name="plus" size={14} strokeWidth={2} />
              Demander l&apos;intégration
            </button>
          }
        />

        {feuilleOuverture()}
      </>
    );
  }

  /* ── La feuille d'ouverture ─────────────────────────────────── */

  function feuilleOuverture() {
    return (
      <Sheet
        open={composant}
        onClose={() => setComposant(false)}
        title={`Intégrer « ${brancheCourante} »`}
      >
        <p className="mb-3 font-mono text-[11px] text-chalk-4">
          {brancheCourante} → {brancheParDefaut}
        </p>

        {/* L'apport de la branche, lu à l'ouverture. Il est écrit en
            clair : quelqu'un qui va proposer un travail doit voir ce
            qu'il propose avant de le nommer. */}
        {apport !== null && (
          <p className="mb-3 font-mono text-[11px] text-chalk-4">
            {apport.length === 0
              ? "aucun changement — enregistrez d'abord un commit."
              : `cette branche apporte ${apport.length} fichier(s), +${apport.reduce((n, d) => n + d.insertions, 0)} −${apport.reduce((n, d) => n + d.deletions, 0)}`}
          </p>
        )}

        <label className="mb-1 block font-mono text-[11px] text-chalk-3">
          titre
        </label>
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          aria-label="Titre de la demande"
          placeholder="ce que cette branche change"
          className="mb-3 h-[var(--h-input)] w-full border border-line-2
            bg-surface-2 px-3 text-[13px] text-chalk
            focus:border-signal"
        />

        <label className="mb-1 block font-mono text-[11px] text-chalk-3">
          description
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-label="Description de la demande"
          placeholder="pourquoi, et comment vérifier"
          rows={4}
          className="mb-4 w-full border border-line-2 bg-surface-2 p-3
            text-[13px] leading-relaxed text-chalk focus:border-signal"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void soumettre()}
            disabled={occupé || titre.trim().length < 3 || apport?.length === 0}
            className="mo-press h-[var(--h-tap)] flex-1 border border-signal
              bg-signal px-4 text-[13px] font-bold text-void
              disabled:opacity-40 disabled:hover:bg-signal"
          >
            Ouvrir la demande
          </button>
          <button
            type="button"
            onClick={() => setComposant(false)}
            className="mo-press h-[var(--h-tap)] border border-line-2 px-4
              text-[13px] text-chalk-3 hover:border-chalk-4 hover:text-chalk"
          >
            Annuler
          </button>
        </div>

        {titre.trim().length > 0 && titre.trim().length < 3 && (
          <p className="mt-2 font-mono text-[11px] text-chalk-4">
            3 caractères minimum.
          </p>
        )}
      </Sheet>
    );
  }

  /* ── La liste ───────────────────────────────────────────────── */

  return (
    <>
      {lignes === null && <Loading label="Demandes" />}

      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => void ouvrirFeuille()}
          className="mo-press inline-flex min-h-[var(--h-tap)] items-center gap-1.5
            border border-line-2 px-3 font-mono text-[11.5px] text-chalk-3
            hover:border-signal hover:text-signal"
        >
          <Icon name="plus" size={12} strokeWidth={2} />
          Demander l&apos;intégration
        </button>
      </div>

      <ul className="space-y-1.5">
        {lignes?.map((ligne, index) => {
          const { pull, diff, verdict, brancheAbsente } = ligne;
          const deploye = ouverte === pull.id;
          const ajouts = diff.reduce((n, d) => n + d.insertions, 0);
          const retraits = diff.reduce((n, d) => n + d.deletions, 0);
          const fusionnable = verdict?.fusionnable === true;

          return (
            <Motion key={pull.id} role="rise" delay={Math.min(index * 40, 320)} as="li">
              <div
                className={`border bg-surface transition-colors duration-[var(--d-fast)]
                  ${deploye ? "border-signal" : "border-line-2 hover:border-line-3"}`}
              >
                <button
                  type="button"
                  onClick={() => setOuverte(deploye ? null : pull.id)}
                  aria-expanded={deploye}
                  aria-label={`Demande numéro ${pull.number}`}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`tnum mt-0.5 shrink-0 font-mono text-[11.5px]
                      ${pull.status === "ouverte" ? "text-signal" : "text-chalk-4"}`}
                  >
                    #{pull.number}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[13px] leading-snug
                        ${pull.status === "ouverte" ? "text-chalk" : "text-chalk-3"}`}
                    >
                      {pull.title}
                    </span>

                    {/* Les branches sont le nom de la demande : deux
                        demandes peuvent porter le même titre, mais deux
                        branches non. */}
                    {/* La flèche est un caractère, pas une icône : entre
                        deux noms de branche elle doit rester sur la ligne
                        du texte, quelle que soit sa largeur — et une
                        icône de 9 px poserait des points de suspension
                        visuellement détachés du texte qu'elle relie. */}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 font-mono text-[10.5px] text-chalk-4">
                      <Icon name="branch" size={9} />
                      <span className="text-signal">{pull.source_branch}</span>
                      <span aria-hidden>→</span>
                      <span>{pull.target_branch}</span>
                      <span>·</span>
                      <span>@{pull.author?.pseudo ?? "inconnu"}</span>
                      <span>·</span>
                      <span>{timeAgo(pull.created_at)}</span>
                    </span>

                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10.5px] text-chalk-4">
                      {/* Une branche supprimée n'a pas de diff à
                          annoncer : la comparer à une branche vide
                          ferait dire à la demande qu'elle a tout
                          retiré. */}
                      {brancheAbsente ? (
                        <span className="text-chalk-4">branche supprimée</span>
                      ) : (
                        <>
                          <span className="tnum">
                            {diff.length === 1 ? "1 fichier" : `${diff.length} fichiers`}
                          </span>
                          <span className="tnum text-signal">+{ajouts}</span>
                          <span className="tnum text-danger">−{retraits}</span>
                        </>
                      )}
                      {pull.status === "fusionnee" && (
                        <>
                          <span>·</span>
                          <span className="text-ok">
                            intégrée {pull.merged_at ? timeAgo(pull.merged_at) : ""}
                          </span>
                        </>
                      )}
                      {pull.status === "fermee" && (
                        <>
                          <span>·</span>
                          <span className="text-chalk-4">fermée</span>
                        </>
                      )}
                    </span>
                  </span>

                  <Icon
                    name={deploye ? "chevron-down" : "chevron-right"}
                    size={12}
                    className="mt-1 shrink-0 text-chalk-4"
                  />
                </button>

                {deploye && (
                  <div className="border-t border-line-2 px-3 py-3">
                    {pull.body && (
                      <p className="mb-3 whitespace-pre-wrap text-sm leading-relaxed text-chalk-2">
                        {pull.body}
                      </p>
                    )}

                    {/* ── Le diff ── */}
                    {brancheAbsente ? (
                      <p className="mb-3 font-mono text-[11px] text-chalk-4">
                        la branche « {pull.source_branch} » a été supprimée — son
                        travail est dans « {pull.target_branch} ».
                      </p>
                    ) : (
                      diff.length === 0 && (
                        <p className="mb-3 font-mono text-[11px] text-chalk-4">
                          Aucun changement.
                        </p>
                      )
                    )}

                    {diff.map((d) => (
                      <div key={d.path} className="mb-2 last:mb-0">
                        <p className="mb-1 font-mono text-[11px] text-chalk-3">
                          {d.path}
                        </p>
                        <pre className="overflow-x-auto font-mono text-[11.5px] leading-[1.55]">
                          {d.lines.map((l, i) => (
                            <span
                              key={i}
                              className={
                                l.kind === "ajout"
                                  ? "block text-signal"
                                  : l.kind === "suppression"
                                    ? "block text-danger"
                                    : "block text-chalk-3"
                              }
                            >
                              {l.kind === "ajout" ? "+" : l.kind === "suppression" ? "−" : " "}
                              {l.text || " "}
                            </span>
                          ))}
                        </pre>
                      </div>
                    ))}

                    {/* ── Les actes ──
                        Le verdict est affiché **avec** le bouton qu'il
                        conditionne, jamais à sa place : quelqu'un qui
                        ne comprend pas pourquoi il ne peut pas fusionner
                        doit pouvoir le lire sans avoir cliqué. */}
                    {pull.status === "ouverte" && verdict && (
                      <>
                        <p
                          className={`mt-3 mb-2 font-mono text-[11px] leading-relaxed
                            ${fusionnable ? "text-chalk-3" : "text-danger"}`}
                        >
                          {verdict.raison}
                          {verdict.fichiers.length > 0 && (
                            <span className="block text-chalk-4">
                              {verdict.fichiers.join(", ")}
                            </span>
                          )}
                        </p>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void fusionner(pull)}
                            disabled={!fusionnable || occupé}
                            className="mo-press inline-flex min-h-[var(--h-tap)]
                              items-center gap-1.5 border border-ok px-3
                              font-mono text-[11.5px] font-bold text-ok
                              disabled:border-line-2 disabled:text-chalk-4
                              disabled:opacity-60"
                          >
                            <Icon name="fork" size={11} strokeWidth={2} />
                            Fusionner dans {pull.target_branch}
                          </button>

                          <button
                            type="button"
                            onClick={() => void fermer(pull)}
                            disabled={occupé}
                            className="mo-press min-h-[var(--h-tap)] border
                              border-line-2 px-3 font-mono text-[11.5px]
                              text-chalk-4 hover:border-danger hover:text-danger"
                          >
                            Fermer
                          </button>
                        </div>
                      </>
                    )}

                    {pull.status === "fusionnee" && (
                      <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ok">
                        <Icon name="check-double" size={12} strokeWidth={2} />
                        intégrée dans {pull.target_branch}
                        {pull.merged_at ? ` · ${timeAgo(pull.merged_at)}` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Motion>
          );
        })}
      </ul>

      {feuilleOuverture()}
    </>
  );
}