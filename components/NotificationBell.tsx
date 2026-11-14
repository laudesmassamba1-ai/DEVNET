"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { api } from "@/lib/api/client";
import {
  playChime,
  showNotification,
  syncBadge,
  unlockAudio,
} from "@/lib/device-notify";
import { fetchUnreadSummary } from "@/lib/notifications";
import { useSession } from "@/hooks/useSession";
import type { UnreadSummary } from "@/lib/notifications";

/**
 * La cloche — l'unique point d'entrée du centre de notifications.
 *
 * Elle est dans la barre de titre plutôt que dans la barre basse pour
 * deux raisons : la barre basse garde une action de création et un accès
 * « Plus » pour les autres sections ; et la cloche doit être visible
 * **partout**, y compris dans les écrans
 * où elle n'a rien à faire d'autre que compter. Une icône dans un
 * onglet ne se voit que quand on est déjà sur l'onglet d'à côté.
 *
 * **Le compteur est un plancher, pas une estimation.** Il vient de la
 * même fonction de repli que la liste du centre : cinq messages de la
 * même personne font un groupe, donc « 1 ». Sans cela, la cloche
 * annoncerait un chiffre que la liste ne montrera jamais — et le
 * désaccord se voit la première fois qu'on l'ouvre.
 *
 * Ce chiffre comprend **l'alerte des défis du jour**, la seule entrée du
 * centre qui n'a pas de ligne en base. Elle est ajoutée par
 * `fetchUnreadSummary` elle-même (`lib/challengeAlert.ts`), donc la
 * cloche et la liste la comptent du même côté : il n'y a rien à faire
 * ici, et c'est exactement le but.
 *
 * Trois manières de le rafraîchir, parce qu'aucune ne suffit seule :
 *
 * - **au montage et à chaque navigation** — le cas ordinaire ;
 * - **temps réel** — quelqu'un vient d'écrire, le chiffre doit
 *   bouger sans rechargement ;
 * - **toutes les 45 secondes** — filet de sécurité. `postgres_changes`
 *   suppose que la table est dans la publication realtime, ce qui
 *   n'est pas acquis sur un projet neuf ; sans ce filet, une
 *   notification arrivée hors canal resterait invisible jusqu'au
 *   changement de page. Trente secondes suffiraient ; on laisse une
 *   marge parce que le filet n'a pas d'urgence.
 */
export function NotificationBell() {
  const { profile } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [summary, setSummary] = useState<UnreadSummary | null>(null);
  const me = profile?.id;
  const here = pathname === "/notifications";

  const load = useCallback(async () => {
    if (!me) {
      setSummary(null);
      void syncBadge(0);
      return;
    }
    const next = await fetchUnreadSummary(me);
    setSummary(next);
    // Le chiffre de l'icône est le même que celui de la cloche : deux
    // compteurs séparés finiraient par diverger.
    void syncBadge(next.total);
  }, [me]);

  // L'audio d'iOS ne démarre qu'après un geste : on l'ouvre au premier
  // appui, sans jouer quoi que ce soit.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // L'icône garde le dernier chiffre connu quand l'application revient au
  // premier plan : sans cela, un message reçu entre-temps n'apparaîtrait
  // qu'au prochain rafraîchissement de la cloche.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me) {
        if (alive) setSummary(null);
        return;
      }
      const next = await fetchUnreadSummary(me);
      if (alive) setSummary(next);
    })();
    return () => {
      alive = false;
    };
  }, [me, pathname]);

  useEffect(() => {
    if (!me) return;

    const channel = api
      .channel(`notifications-${me}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${me}`,
        },
        (payload: { new?: { kind?: string; actor_id?: string | null; conversation_id?: string | null } }) => {
          void load();

          // Un message reçu n'est pas une ligne de plus dans une liste :
          // c'est quelqu'un qui attend. On le dit par une bannière et un
          // son, sauf si l'écran des messages est déjà ouvert — auquel cas
          // la bulle qui apparaît suffit et doubler l'annonce serait
          // grossier.
          if (payload?.new?.kind !== "message") return;
          if (window.location.pathname.startsWith("/messages")) return;
          playChime();
          void showNotification({
            title: "Nouveau message",
            body: "Tu as reçu un message sur DevNet.",
            tag: `dm-${payload.new.conversation_id ?? "devnet"}`,
            url: payload.new.conversation_id
              ? `/messages?conversation=${payload.new.conversation_id}`
              : "/messages",
          });
        },
      )
      .subscribe();

    return () => {
      void api.removeChannel(channel);
    };
  }, [me, load]);

  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => void load(), 45_000);
    return () => clearInterval(timer);
  }, [me, load]);

  const unread = summary?.total ?? 0;
  const label = summary?.saturated
    ? `${unread}+`
    : String(unread);

  return (
    /* La taille est le jeton `--h-tap`, comme `IconButton` : la cloche
       est le bouton le plus proche du pouce — c'est celui qu'on presse
       sans regarder. 34 px en dur, c'était exactement la dérogation que
       la règle dure interdisait. */
    <button
      type="button"
      data-tour="bell"
      onClick={() => router.push("/notifications")}
      aria-label={
        unread > 0
          ? `Notifications — ${summary?.saturated ? "plus de" : ""} ${unread} non lue${unread > 1 ? "s" : ""}`
          : "Notifications — rien de non lu"
      }
      aria-current={here ? "page" : undefined}
      className={`mo-press relative flex size-(--h-tap) items-center justify-center
        border-(--bw-thin) transition-[background-color,color,border-color]
        duration-(--d-fast) ease-(--ease-spring)
        ${here
          ? "border-signal bg-signal text-void shadow-(--shadow-action)"
          : "border-line-2/40 text-chalk hover:border-signal hover:bg-signal/10 hover:text-signal"
        }`}
      >
      <Icon name="notifications" size={16} />

      {/* Le compteur apparaît d'un coup, sans animation : c'est un
          compteur, pas un événement. Le seul mouvement de ce bouton est
          sa pression — ce qui est déjà le cas partout. */}
      {unread > 0 && (
        <span
          className={`tnum absolute -top-1 -right-0.5 flex min-w-[20px] rounded-full
            items-center justify-center border px-1 font-mono text-12
            leading-[15px] font-bold
${here ? "border-surface bg-signal text-void shadow-(--shadow-action)"
          : "border-void bg-signal text-void shadow-(--shadow-action)"}`}
        >
          {label}
        </span>
      )}
    </button>
  );
}