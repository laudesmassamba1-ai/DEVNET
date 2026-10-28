"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "@/components/ChatComposer";
import { Icon } from "@/components/Icon";
import { useSession } from "@/hooks/useSession";
import { avatarClass, clockTime, initials } from "@/lib/utils";
import type { CollabChatMessage } from "@/lib/collab/cursors";

/**
 * Le fil d'équipe de l'éditeur.
 *
 * ## Un panneau, pas une conversation
 *
 * Contrairement à la messagerie, ce fil n'a pas d'historique : il vit dans
 * le `broadcast` de la salle du fichier, et disparaît avec l'onglet. Le
 * composant est donc **présentationnel** — il reçoit les messages et un
 * `onSend`, et n'ouvre aucun canal lui-même. Le canal est tenu une fois,
 * par `useCollab`, et partagé avec le calque des curseurs : deux
 * abonnements au même canal se recouvriraient en démonstration.
 *
 * ## La session, ici, ne sert qu'à une chose
 *
 * Savoir **qui écrit**. L'auteur d'un message reçu porte déjà son pseudo et
 * sa couleur ; l'utilisateur courant, lui, n'est pas dans la charge. On le
 * lit donc avec `useSession` pour marquer ses propres messages et signer le
 * composeur — pas pour re-résoudre l'identité des autres.
 */
export interface TeamChatProps {
  messages: CollabChatMessage[];
  onSend: (text: string) => void;
  title?: string;
  placeholder?: string;
  className?: string;
}

export function TeamChat({
  messages,
  onSend,
  title = "équipe",
  placeholder = "Message à l'équipe…",
  className = "",
}: TeamChatProps) {
  const { profile, loading } = useSession();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Le fil est lu de haut en bas : le dernier message doit être visible sans
  // geste. On ne défile que sur l'arrivée d'un message, pas à chaque frappe.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const empty = useMemo(() => messages.length === 0, [messages.length]);

  const send = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft("");
  };

  return (
    <section
      aria-label="Discussion d'équipe"
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-card)]
        border border-line-3 bg-surface-2/40 ${className}`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line-2 px-3 py-2">
        <Icon name="messages" size={14} className="text-chalk-3" />
        <span className="label-micro text-chalk-4">{title}</span>
        <span className="ml-auto font-mono text-[10.5px] tnum text-chalk-4">
          {messages.length}
        </span>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
        {empty ? (
          <p className="py-6 text-center font-mono text-[11px] text-chalk-4">
            personne n&apos;a encore écrit — le fil vit le temps de la session
          </p>
        ) : (
          messages.map((message) => {
            const mine = profile?.id === message.userId;
            const name = message.pseudo || "un pair";

            return (
              <div key={message.id} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-[20px] shrink-0 items-center justify-center
                    rounded-full border font-display text-[9px] font-bold
                    ${avatarClass(message.color)}`}
                >
                  {initials(name)}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-1.5">
                    <span className="truncate font-mono text-[11px] text-chalk-2">{name}</span>
                    {mine && <span className="font-mono text-[10px] text-signal-d">vous</span>}
                    <span className="ml-auto shrink-0 font-mono text-[10px] tnum text-chalk-4">
                      {clockTime(message.at)}
                    </span>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-chalk">
                    {message.text}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-line-2 p-2">
        <ChatComposer
          id="collab-team-chat"
          value={draft}
          onValueChange={setDraft}
          onSend={send}
          placeholder={placeholder}
          disabled={loading || !profile}
          sending={false}
        />
        {profile && (
          <p className="mt-1 px-0.5 font-mono text-[10px] text-chalk-4">
            {profile.pseudo} — fil volatil, non conservé
          </p>
        )}
      </div>
    </section>
  );
}
