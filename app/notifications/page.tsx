"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Avatar, EmptyState, Loading, PrimaryButton, Spinner } from "@/components/Avatar";
import { Icon, type IconName } from "@/components/Icon";
import { Motion, waitForExit } from "@/components/Motion";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { badgeFor, xpOf } from "@/lib/verification";
import { timeAgo } from "@/lib/utils";
import { NOTIFICATION_KINDS, KIND_LABEL, notificationPhrase, unreadIds } from "@/lib/notify";
import {
  clearNotifications,
  dismissNotifications,
  fetchNotificationPage,
  fetchUnreadSummary,
  markAllRead,
  markRead,
  notificationHref,
  type NotificationPage,
} from "@/lib/notifications";
import { markChallengeAlertSeen } from "@/lib/challengeAlert";
import type { NotificationGroup, NotificationKindKey } from "@/lib/notify";
import type { UnreadSummary } from "@/lib/notifications";

/**
 * Le centre de notifications.
 *
 * Une liste, quatre filtres, deux actions. C'est tout ce dont l'écran
 * a besoin, et le minimalisme est ici une décision de lecture : la
 * moitié de ces notifications a plus de trois mois, et personne ne
 * les ouvrira. Un écran qui promet un tri par importance mettrait en
 * avant une importance qu'on ne sait pas mesurer.
 *
 * **Les lignes sont des groupes, pas des événements.** Cinq messages de
 * Thabo dans la même conversation font une ligne « Thabo vous écrit 5
 * messages », pas cinq lignes. Le repli est fait par la fonction de
 * données, donc le compteur de la cloche et cette liste comptent
 * pareil — sans quoi on ouvrirait le centre pour trouver « 7 » dans une
 * liste de trois lignes.
 *
 * **Le pliage se fait après la pagination**, donc un groupe coupé par
 * la frontière de page n'apparaît que sur la page où se trouve son
 * événement le plus récent. Le comportement est irrégulier mais il est
 * exact : ce qui est affiché a bien eu lieu, et le groupe n'est pas
 * compté deux fois.
 */

/** L'icône d'un type — même vocabulaire que la barre basse. */
const KIND_ICON: Record<NotificationKindKey, IconName> = {
  challenge: "target",
  like: "like",
  follow: "follow",
  mention: "comment",
  message: "messages",
};

type Filter = NotificationKindKey | "all";

export default function NotificationsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const router = useRouter();

  const [filter, setFilter] = useState<Filter>("all");
  /**
   * Les groupes en cours de retrait.
   *
   * Un `Set` de clés plutôt qu'un drapeau unique : une liste peut partir
   * de deux façons à la fois (on efface tout pendant qu'une ligne jouait
   * sa sortie), et un booléen ne saurait pas représenter ça.
   */
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [page, setPage] = useState<NotificationPage | null>(null);
  const [unread, setUnread] = useState<UnreadSummary | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const me = profile?.id;

  /** Recharge le compteur — c'est lui qui habille les onglets. */
  const loadUnread = useCallback(async () => {
    if (!me) return;
    setUnread(await fetchUnreadSummary(me));
  }, [me]);

  const load = useCallback(async () => {
    if (!me) return;
    const first = await fetchNotificationPage(me, { kind: filter === "all" ? null : filter });
    setPage(first);
    void loadUnread();
  }, [me, filter, loadUnread]);

  useEffect(() => {
    // Réinitialisation au changement de fil : la page passe vide pendant le
    // fetch, sinon les notes de l'ancien fil restent affichées sous le
    // bandeau de chargement. C'est un reset d'affichage, pas un rendu dérivé.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(null);
    void (async () => {
      await load();
    })();
  }, [load]);

  /** Ajoute la page suivante sans remplacer la précédente. */
  async function loadMore() {
    if (!me || !page?.more || loadingMore) return;
    setLoadingMore(true);

    const next = await fetchNotificationPage(me, {
      kind: filter === "all" ? null : filter,
      before: page.cursor,
    });

    setPage((prev) =>
      prev
        ? {
            groups: [...prev.groups, ...next.groups],
            more: next.more,
            cursor: next.cursor,
            excerpts: new Map([...prev.excerpts, ...next.excerpts]),
          }
        : next,
    );
    setLoadingMore(false);
  }

  /**
   * Ouvre un groupe : on marque **tout** le groupe comme lu, pas la
   * ligne cliquée.
   *
   * Marquer une seule des cinq notifications lues laisserait les quatre
   * autres dans la liste — alors qu'on vient de lire ce qu'elles
   * disent. Le groupe est l'unité de lecture, donc l'unité de « lu ».
   */
  async function open(group: NotificationGroup) {
    if (group.kind === "challenge") {
      // Une ligne dérivée n'a pas d'identifiant en base : « marquer lu »
      // est ici un acquittement local, pas un `read_at`.
      if (me) markChallengeAlertSeen(me);
    } else {
      const ids = unreadIds(group);
      if (ids.length > 0) await markRead(ids);
    }
    await loadUnread();
    router.push(notificationHref(group));
  }

  /** Supprime un groupe entier, sans le marquer comme lu d'abord. */
  async function dismiss(group: NotificationGroup) {
    if (group.kind === "challenge") {
      // Rien à supprimer en base — l'alerte est dérivée. L'acquitter la
      // retire du jour ; elle reviendra demain avec le nouveau tirage.
      if (me) markChallengeAlertSeen(me);
    } else {
      const ids = group.members.map((m) => m.id);
      const { error } = await dismissNotifications(ids);
      if (error) return toast(`Erreur : ${error}`, "err");
    }

    // La ligne ne part pas maintenant : elle joue d'abord son retrait, et
    // n'est retirée de l'état qu'une fois l'animation terminée. Sans ce
    // délai, la ligne disparaîtrait d'un coup — l'animation de sortie
    // n'aurait jamais lieu, puisqu'elle joue sur un élément déjà absent.
    setLeaving((prev) => new Set(prev).add(group.key));
    await waitForExit();

    setPage((prev) =>
      prev ? { ...prev, groups: prev.groups.filter((g) => g.key !== group.key) } : prev,
    );
    setLeaving((prev) => {
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
    void loadUnread();
  }

  async function readAll() {
    if (!me) return;
    // L'alerte dérivée n'est pas dans la table : `markAllRead` ne peut
    // pas l'atteindre, et il faut l'acquitter ici. Sinon « tout lire »
    // laisserait un « 1 » que la liste ne montrerait plus comme non lu.
    markChallengeAlertSeen(me);
    const { error } = await markAllRead(me);
    if (error) return toast(`Erreur : ${error}`, "err");

    // Les lignes déjà chargées changent d'apparence : les marquer dans
    // l'état plutôt que recharger évite de faire clignoter la liste entière
    // après un clic.
    setPage((prev) =>
      prev
        ? {
            ...prev,
            groups: prev.groups.map((g) => ({ ...g, unread: 0 })),
          }
        : prev,
    );
    void loadUnread();
    toast("Tout marqué comme lu");
  }

  /**
   * Vide le centre. Destructif, donc demandé puis confirmé — la
   * confirmation vit dans la barre d'outils, à côté du bouton, comme
   * pour la suppression d'une publication : on n'ouvre pas de fenêtre
   * pour demander de confirmer ce qu'on voit déjà à l'écran.
   */
  async function clear() {
    if (!me) return;
    // Même raison que dans `readAll` : vider le centre ne peut pas
    // emporter une alerte qui n'a pas de ligne, donc on l'acquitte.
    markChallengeAlertSeen(me);
    const { error } = await clearNotifications(me);
    setConfirmClear(false);
    if (error) return toast(`Erreur : ${error}`, "err");

    // Toutes les lignes partent ensemble : on les marque d'un seul coup,
    // puis on vide après le retrait. Sans l'attente, la liste se viderait
    // instantanément et la seule chose visible serait le vide.
    setLeaving(new Set((page?.groups ?? []).map((g) => g.key)));
    await waitForExit();

    setPage((prev) => (prev ? { ...prev, groups: [] } : prev));
    setLeaving(new Set());
    void loadUnread();
    toast("Centre vidé");
  }

  const unreadTotal = unread?.total ?? 0;
  const emptyAll = page !== null && page.groups.length === 0;

  return (
    <AppShell title="Notifications" path="~/notifications">
      <div className="px-(--gutter) pt-3" data-tour="notifications-list">
        {/* ── Barre d'outils ──
            Deux actions, à droite, dans la disposition qu'elles ont
            partout ailleurs : l'action principale en texte d'accent,
            la destructive en contour. */}
        <div className="mb-3 flex items-center gap-2">
          <p className="label-micro flex-1 text-chalk-4">
            {unreadTotal > 0
              ? `${unreadTotal} non lue${unreadTotal > 1 ? "s" : ""}`
              : "aucune non lue"}
          </p>

          {unreadTotal > 0 && (
            <button
              type="button"
              onClick={readAll}
              className="label-micro flex min-h-[var(--h-action)] shrink-0 items-center
                border border-line-2 px-2 text-chalk-3 transition-colors duration-[var(--d-fast)]
                hover:border-signal hover:text-signal"
            >
              tout lire
            </button>
          )}

          {!emptyAll &&
            (confirmClear ? (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={clear}
                  className="label-micro flex min-h-[var(--h-action)] items-center border
                    border-danger px-2 text-danger
                    transition-colors duration-[var(--d-fast)] hover:bg-danger
                    hover:text-void"
                >
                  vider
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="label-micro flex min-h-[var(--h-action)] items-center border
                    border-line-2 px-2 text-chalk-4 transition-colors duration-[var(--d-fast)] hover:text-chalk"
                >
                  annuler
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="label-micro flex min-h-[var(--h-action)] shrink-0 items-center
                  border border-line-2 px-2 text-chalk-4 transition-colors
                  duration-[var(--d-fast)] hover:border-danger hover:text-danger"
              >
                vider
              </button>
            ))}
        </div>

        {/* ── Filtres ──
            Les compteurs viennent de la même requête que la cloche,
            donc « non lus » ne veut pas dire deux choses selon l'écran
            où on le lit. */}
        <div
          role="tablist"
          aria-label="Type de notification"
          className="mb-3 flex gap-0 overflow-x-auto border-b border-line-2"
        >
          {([["all", "Tout"], ...NOTIFICATION_KINDS.map((k) => [k, KIND_LABEL[k]])] as [
            Filter,
            string,
          ][]).map(([value, label]) => {
            const count = value === "all" ? unreadTotal : (unread?.byKind[value] ?? 0);
            return (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`-mb-0.5 flex min-h-[var(--h-tap)] shrink-0 items-center tab-underline px-3 py-2 font-mono text-[11.5px]
                  font-bold tracking-[0.12em] uppercase transition-colors
                  duration-[var(--d-fast)]
                  ${filter === value
                    ? "text-signal"
                    : "text-chalk-4 hover:text-chalk-2"}`}
              >
                {label}
                {count > 0 && <span className="tnum ml-1.5 text-chalk-3">{count}</span>}
              </button>
            );
          })}
        </div>

        {page === null && <Loading label="Lecture des notifications" />}

        {/* Centre vide : deux cas, deux invites. Un centre vide alors
            qu'on filtre sur les mentions n'est pas le même problème
            qu'un centre vide tout court. */}
        {emptyAll && filter === "all" && (
          <EmptyState
            icon={<Icon name="notifications" size={20} strokeWidth={1.5} />}
            title="Rien à signaler"
            action={
              <PrimaryButton icon="feed" onClick={() => router.push("/feed")}>
                Retour au fil
              </PrimaryButton>
            }
          />
        )}

        {emptyAll && filter !== "all" && (
          <EmptyState
            icon={<Icon name={KIND_ICON[filter]} size={20} strokeWidth={1.5} />}
            title={
              // « Aucune défis » serait faux deux fois : le genre, et le
              // fait que les défis existent — ils sont juste déjà vus. On
              // dit donc la vérité plutôt qu'un pluriel par défaut.
              filter === "challenge" ? "Rien à annoncer" : `Aucune ${KIND_LABEL[filter].toLowerCase()}`
            }
            hint={
              filter === "challenge"
                ? "Tu as vu les défis du jour. Le tirage change à minuit."
                : undefined
            }
          />
        )}

        {/* ── Liste ──
            Une notification non lue porte un filet d'accent à gauche :
            c'est le repère le moins coûteux à voir en balayant la liste,
            et il ne demande pas de lire les lignes. */}
        {page?.groups.map((group, i) => {
          const latest = group.latest;
          const actor = latest.actor;
          const name = actor?.prenom ?? "Un compte supprimé";
          const unreadGroup = group.unread > 0;
          const excerpt = latest.post_id ? page.excerpts.get(latest.post_id) : undefined;

          return (
            <Motion
              key={group.key}
              // `none` retire la classe d'entrée : une ligne qui part ne
              // doit pas rejouer son animation d'arrivée en même temps
              // que sa sortie.
              role={leaving.has(group.key) ? "none" : "rise"}
              delay={Math.min(i * 40, 400)}
              className={leaving.has(group.key) ? "mo-exit" : ""}
            >
              <div
                className={`lift-card mb-2 flex overflow-hidden rounded-[var(--radius-card)]
                  border bg-surface shadow-sh-1
                  ${unreadGroup ? "border-line-3" : "border-line-2/60"}`}
              >
                {unreadGroup && <span className="w-[3px] shrink-0 bg-signal" />}

                <button
                  type="button"
                  onClick={() => void open(group)}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3.5 py-3 text-left"
                >
                  {group.kind === "challenge" ? (
                    /* Pas d'avatar : l'alerte ne vient d'aucune personne.
                       L'icône du défi tient la place, à la même taille, pour
                       que la ligne garde l'alignement des autres. */
                    <span
                      aria-hidden="true"
                      className="flex size-[34px] shrink-0 items-center justify-center
                        rounded-[var(--radius-input)] border border-signal/40 bg-signal/12 text-signal"
                    >
                      <Icon name="target" size={16} strokeWidth={1.9} />
                    </span>
                  ) : (
                    <Avatar name={name} color={actor?.avatar_color} />
                  )}

                  <div className="min-w-0 flex-1">
                    {group.kind === "challenge" ? (
                      <>
                        <p className="text-[13.5px] font-bold">{KIND_LABEL.challenge} du jour</p>
                        <p className="mt-1 text-[12px] text-chalk-4">
                          Trois défis vous attendent aujourd&apos;hui. Relevez-les sur votre profil.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                          <Icon
                            name={KIND_ICON[group.kind]}
                            size={12}
                            strokeWidth={2}
                            className="translate-y-px text-signal"
                          />
                          <span className={`text-[13.5px] ${unreadGroup ? "font-bold" : "font-semibold"}`}>
                            {name}
                          </span>
                          {actor?.verified && <VerifiedBadge tier={badgeFor(actor, xpOf(actor))} size="sm" className="translate-y-[1px]" />}
                          <span className="text-[13px] text-chalk-3">
                            {notificationPhrase(group.kind, group.count)}
                          </span>
                          {group.count > 1 && (
                            <span className="tnum label-micro border border-line-2 px-1 text-chalk-3">
                              ×{group.count}
                            </span>
                          )}
                        </p>

                        {/* L'extrait dit *de quoi* parle la notification.
                            Sans lui, douze likes se ressemblent douze fois. */}
                        {excerpt && (
                          <p className="mt-1 truncate text-[12px] text-chalk-4">« {excerpt} »</p>
                        )}
                      </>
                    )}

                    <p className="label-micro mt-1.5 text-chalk-4">
                      {timeAgo(latest.created_at)}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void dismiss(group)}
                  aria-label="Supprimer cette notification"
                  className="flex w-11 shrink-0 items-center justify-center border-l
                    border-line text-chalk-4 transition-colors
                    duration-[var(--d-fast)] hover:border-danger hover:text-danger"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            </Motion>
          );
        })}

        {page?.more && (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex h-[var(--h-tap)] items-center gap-2
                rounded-[var(--radius-input)] border border-line-2 px-4
                font-mono text-[11.5px] font-bold tracking-[0.12em]
                text-chalk-3 uppercase transition-colors
                duration-[var(--d-fast)] hover:border-signal hover:text-signal
                disabled:opacity-40"
            >
              <span aria-hidden={loadingMore || undefined}>
                {loadingMore ? <Spinner /> : null}
              </span>
              {loadingMore ? null : "Charger plus"}
            </button>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </AppShell>
  );
}