"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, asIconName } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { fetchForksOf } from "@/lib/fork";
import { api } from "@/lib/api/client";
import { timeAgo } from "@/lib/utils";
import type { ForkRelation } from "@/lib/fork";

/** La carte minimale d'un projet sibling, pour la ligne de l'arbre. */
interface ForkChild {
  id: string;
  name: string;
  emoji: string;
  language: string;
  created_at: string;
}

/**
 * L'arbre des forks d'un projet.
 *
 * Deux niveaux suffisent à l'écran : le **parent** (d'où vient ce code)
 * et les **enfants** (qui en a repoussé). Les petits-enfants sont déjà
 * tous reliés à la racine par `root_project_id` — ils apparaissent
 * ailleurs, sur le projet où ils se rattachent à la lignée, et un arbre
 * récursif n'a rien de plus à dire que deux listes lisibles.
 *
 * La profondeur se voit dans le retrait, pas dans une décoration : le
 * parent est au-dessus d'un trait, les enfants en dessous, et le lien
 * « root » est affiché en une ligne de texte plutôt qu'un graphe.
 */
export function ForkTreePanel({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [relation, setRelation] = useState<ForkRelation | null>(null);
  const [parent, setParent] = useState<{ id: string; name: string; emoji: string } | null>(null);
  const [children, setChildren] = useState<ForkChild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // La relation de ce projet : est-il lui-même un fork ?
        const { data: forkRow } = await api
          .from("project_forks")
          .select("id, fork_id, source_id, root_project_id, source_branch, source_sha, forked_by, forked_at")
          .eq("fork_id", projectId)
          .maybeSingle();
        const rel = (forkRow as unknown as ForkRelation) ?? null;
        if (!alive) return;
        setRelation(rel);

        // Le parent direct, pour la ligne d'origine.
        if (rel) {
          const { data: src } = await api
            .from("projects")
            .select("id, name, emoji")
            .eq("id", rel.source_id)
            .maybeSingle();
          if (alive) setParent((src as { id: string; name: string; emoji: string } | null) ?? null);
        }

        // Les descendants directs.
        const kids = await fetchForksOf(projectId);
        if (!alive) return;
        if (!kids.length) {
          setChildren([]);
          return;
        }
        const ids = kids.map((k) => k.fork_id);
        const { data: rows } = await api
          .from("projects")
          .select("id, name, emoji, language, created_at")
          .in("id", ids);
        if (alive) {
          const byId = new Map((rows as ForkChild[]).map((r) => [r.id, r]));
          setChildren(kids.map((k) => byId.get(k.fork_id)).filter((c): c is ForkChild => Boolean(c)));
        }
      } catch {
        // Les tables de la 025 n'existent pas encore : l'écran se tait,
        // il ne se casse pas.
        if (alive) toast("Les forks ne sont pas encore disponibles.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, toast]);

  if (loading) return null;
  if (!relation && children.length === 0) return null;

  return (
    <section className="rounded-(--radius-card) border border-line-2 bg-surface-2 p-4">
      <h3 className="label mb-3 flex items-center gap-1.5 text-chalk-3">
        <Icon name="fork" size={12} strokeWidth={1.8} />
        Lignée du dépôt
      </h3>

      <div className="flex flex-col items-stretch gap-1.5">
        {/* Le parent : d'où vient ce code. */}
        {relation && parent && (
          <button
            type="button"
            onClick={() => router.push(`/projects/${parent.id}`)}
            className="mo-press flex items-center gap-2.5 rounded-(--radius-chip)
              border border-line-2 bg-surface px-3 py-2 text-left transition-colors
              hover:border-signal"
            title={`Origine : ${parent.name}`}
          >
            <Icon name={asEmoji(parent.emoji)} size={12} className="shrink-0 text-chalk-3" />
            <span className="min-w-0 flex-1">
              <span className="label-micro block text-chalk-3">forké de</span>
              <span className="block truncate text-13 font-bold text-chalk">{parent.name}</span>
            </span>
            <Icon name="chevron-right" size={11} strokeWidth={2} className="shrink-0 text-chalk-4" />
          </button>
        )}

        {/* Les enfants : qui a continué à partir d'ici. */}
        {children.length > 0 && (
          <div className="ml-3 border-l-2 border-line-2 pl-3">
            <p className="label-micro mb-1.5 text-chalk-3">
              {children.length} fork{children.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-1.5">
              {children.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/projects/${c.id}`)}
                    className="mo-press flex w-full items-center gap-2 rounded-(--radius-chip)
                      bg-surface px-2.5 py-1.5 text-left text-chalk transition-colors
                      hover:bg-surface-2"
                    title={c.language}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-(--radius-chip)
                        border border-line-2 bg-surface-2 text-signal"
                    >
                      <Icon name={asEmoji(c.emoji)} size={9} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-bold">{c.name}</span>
                    <span className="shrink-0 font-mono text-12 text-chalk-4">{timeAgo(c.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {relation && relation.root_project_id !== relation.source_id && (
          <p className="label-micro mt-1 text-chalk-4">
            racine : {relation.root_project_id.slice(0, 8)}
          </p>
        )}
      </div>
    </section>
  );
}

/** L'emoji projet suit le garde du registre : une donnée historique vide retombe sur `layers`. */
function asEmoji(emoji: string) {
  return asIconName(emoji, "layers");
}
