"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { useSession } from "@/hooks/useSession";
import { fetchProjectLink, recordSync } from "@/lib/github/connect";
import { importGithubRepo } from "@/lib/github/import";
import {
  LINK_CHANGED_EVENT,
  liveEnabled,
  planLive,
  shouldAdoptBaseline,
} from "@/lib/github/live";
import { pushToGithub } from "@/lib/github/push";
import { fetchRepoBranches, type GithubReadError } from "@/lib/github/read";
import { GITHUB_ERROR_TEXT } from "@/lib/github/read";
import { SYNC_ERROR_TEXT } from "@/lib/github/sync";
import { fetchBranches, fetchRepoFiles } from "@/lib/repo";
import type { ProjectLink } from "@/lib/types";

/**
 * La boucle de synchronisation GitHub « live ».
 *
 * ## Pourquoi dans le navigateur
 *
 * Il n'y a pas de serveur applicatif (MEMO §9) : « live » ne peut donc pas
 * être un webhook. C'est un **polling** côté page — un tic qui lit la tête
 * de branche GitHub, décide (`planLive`, pur et testable), puis agit.
 *
 * ## Ce que le hook ne fait pas
 *
 * Il ne devine rien : si GitHub n'a pas répondu, il n'adopte pas de sha
 * vide comme référence ; s'il y a divergence, il **ne transfère rien** et
 * le dit. Adopter ou écraser à l'aveugle serait exactement la façon de
 * perdre le travail de quelqu'un.
 */

export type LiveStatus =
  | "idle"
  | "checking"
  | "pulling"
  | "pushing"
  | "diverged"
  | "error";

export interface GithubLiveSync {
  link: ProjectLink | null;
  status: LiveStatus;
  message: string;
  lastCheck: string | null;
  checkNow: () => void;
}

export function useGithubLiveSync(options: {
  projectId: string;
  /** Tête locale de la branche (sha DevNet), pour détecter un commit. */
  localHead: string;
  /** Appelé après un tirage/poussée réussi : la page se relit. */
  onChanged: () => void;
}): GithubLiveSync {
  const { projectId, localHead, onChanged } = options;
  const { profile } = useSession();
  const toast = useToast();

  const [link, setLink] = useState<ProjectLink | null>(null);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [message, setMessage] = useState("");
  const [lastCheck, setLastCheck] = useState<string | null>(null);

  // Des références pour lire l'état le plus récent dans la boucle sans
  // recréer l'intervalle à chaque rendu.
  const running = useRef(false);
  const linkRef = useRef<ProjectLink | null>(null);
  const localHeadRef = useRef(localHead);
  const profileRef = useRef(profile);

  useEffect(() => {
    localHeadRef.current = localHead;
  }, [localHead]);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const reload = useCallback(async () => {
    if (!projectId) return;
    const found = await fetchProjectLink(projectId);
    linkRef.current = found;
    setLink(found);
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      await reload();
    })();
  }, [reload]);

  // Un réglage changé dans le panneau (mode, cadence) doit agir tout de
  // suite, pas après un tick.
  useEffect(() => {
    const onLink = () => {
      void reload();
    };
    window.addEventListener(LINK_CHANGED_EVENT, onLink);
    return () => window.removeEventListener(LINK_CHANGED_EVENT, onLink);
  }, [reload]);

  const tick = useCallback(async () => {
    if (running.current) return;
    const current = linkRef.current;
    if (!current) return;
    if (!liveEnabled(current.sync_mode)) return;

    running.current = true;
    setStatus("checking");

    try {
      const remote = await fetchRepoBranches(current.owner, current.repo);
      if (remote.error || !remote.data) {
        setStatus("error");
        setMessage(remote.error ? GITHUB_ERROR_TEXT[remote.error] : GITHUB_ERROR_TEXT.api);
        return;
      }

      const head =
        remote.data.branches.find((b) => b.name === current.default_branch)?.sha ?? "";
      if (!head) {
        setStatus("error");
        setMessage(`Branche « ${current.default_branch} » introuvable sur GitHub.`);
        return;
      }

      const action = planLive({
        mode: current.sync_mode,
        localHead: localHeadRef.current,
        remoteHead: head,
        lastRemoteSha: current.remote_sha,
        lastLocalSha: current.local_sha,
      });

      if (action.kind === "diverged") {
        setStatus("diverged");
        setMessage(action.reason);
        return;
      }

      if (action.kind === "pull") {
        const me = profileRef.current;
        if (!me) return;
        setStatus("pulling");
        const res = await importGithubRepo({
          owner: current.owner,
          repo: current.repo,
          branch: current.default_branch,
          owner_: { id: me.id, prenom: me.prenom, email: me.email ?? "" },
        });
        if (res.error) {
          setStatus("error");
          setMessage(
            (GITHUB_ERROR_TEXT as Record<string, string>)[res.error] ?? res.error,
          );
          return;
        }
        const refs = await fetchBranches(projectId);
        const newLocal =
          refs.find((r) => r.name === current.default_branch)?.sha ?? "";
        await recordSync(current.id, { remoteSha: head, localSha: newLocal });
        setStatus("idle");
        setMessage(`Tiré de GitHub — ${res.imported} commit(s).`);
        toast(`GitHub → DevNet — ${res.imported} commit(s)`);
        await reload();
        onChanged();
        return;
      }

      if (action.kind === "push") {
        const head_ = localHeadRef.current;
        setStatus("pushing");
        const files = await fetchRepoFiles(projectId, current.default_branch);
        if (files.length === 0) {
          setStatus("error");
          setMessage("Aucun fichier à pousser.");
          return;
        }
        const outcome = await pushToGithub({
          owner: current.owner,
          repo: current.repo,
          branch: current.default_branch,
          headSha: head_,
          expectedRemoteSha: current.remote_sha,
          message: `DevNet → GitHub (${head_.slice(0, 7)})`,
          files: files.map((f) => ({ path: f.path, content: f.content })),
        });
        if (outcome.status === "pushed") {
          await recordSync(current.id, { remoteSha: outcome.sha, localSha: head_ });
          setStatus("idle");
          setMessage(`Poussé vers GitHub — ${outcome.sha.slice(0, 7)}.`);
          toast(`DevNet → GitHub — ${outcome.sha.slice(0, 7)}`);
          await reload();
          onChanged();
          return;
        }
        setStatus("error");
        setMessage(
          outcome.status === "error" ? SYNC_ERROR_TEXT[outcome.code] : "Poussée ignorée.",
        );
        return;
      }

      // `none` : rien à transférer. On mémorise l'état observé pour poser
      // la première référence — sauf si GitHub n'a pas répondu, auquel cas
      // adopter un sha vide rejouerait un tirage au prochain tick.
      setStatus("idle");
      setMessage(action.reason);
      if (shouldAdoptBaseline(action)) {
        const head_ = localHeadRef.current;
        if (head !== current.remote_sha || head_ !== current.local_sha) {
          await recordSync(current.id, { remoteSha: head, localSha: head_ });
          linkRef.current = { ...current, remote_sha: head, local_sha: head_ };
        }
      }
    } catch {
      setStatus("error");
      setMessage(GITHUB_ERROR_TEXT.api);
    } finally {
      setLastCheck(new Date().toISOString());
      running.current = false;
    }
  }, [projectId, toast, reload, onChanged]);

  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!link || !liveEnabled(link.sync_mode)) return;
    const ms = Math.max(10, link.sync_interval_seconds || 30) * 1000;
    void tickRef.current();
    const timer = window.setInterval(() => {
      void tickRef.current();
    }, ms);
    return () => window.clearInterval(timer);
    // On relance la boucle quand le lien, le mode ou la cadence changent.
    // `link` en entier entrerait en conflit avec l'état local du hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.id, link?.sync_mode, link?.sync_interval_seconds]);

  return {
    link,
    status,
    message,
    lastCheck,
    checkNow: () => {
      void tick();
    },
  };
}

/** Réexporté pour que l'écran nomme les erreurs de lecture sans importer deux fois. */
export type { GithubReadError };
