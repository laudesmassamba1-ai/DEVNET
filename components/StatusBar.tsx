"use client";

import {
  createContext, useContext, useEffect, useState, useSyncExternalStore,
} from "react";
import { Icon } from "./Icon";
import { PendingStatus, usePendingVisible } from "./Pending";
import { getBackend, subscribe } from "@/lib/backend";

/**
 * Ligne d'état.
 *
 * L'emprunt le plus explicite à l'outillage : la ligne du bas d'un vim,
 * d'un Emacs, d'un terminal. Elle ne sert pas à naviguer — elle **informe**
 * de l'état, sans que l'utilisateur ait à le demander.
 *
 * Trois informations, par ordre de valeur décroissante :
 *
 * 1. **où** on est — le chemin, comme un chemin de fichier ;
 * 2. **quel** mode — démo ou en ligne : la donnée la plus critique de la
 *    démo, parce que tout ce qu'on lit est fictif et qu'il ne faut pas
 *    l'oublier ;
 * 3. **quand** — l'heure du poste, parce qu'un décalage horaire change la
 *    lecture des horodatages.
 *
 * Le mode démo ne s'affiche que lorsqu'il est actif : une information
 * toujours présente cesse d'être lue.
 *
 * Sur grand écran, cette ligne est rendue par `<Sidebar>` — la barre fixe
 * d'un mobile de 60 px au-dessus d'une autre barre fixe n'est pas une ligne
 * d'état, c'est de l'encombrement.
 */

type Status = { demo: boolean; clock: string };

const StatusContext = createContext<Status>({ demo: false, clock: "" });

/** Source unique de l'horloge et du mode : la barre et la sidebar lisent le même état. */
export function useStatus(): Status {
  return useContext(StatusContext);
}

export function StatusProvider({ children }: { children: React.ReactNode }) {
  const [clock, setClock] = useState("");
  const backend = useSyncExternalStore(subscribe, getBackend, getBackend);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" }),
      );
    tick();
    // Une minute de battement suffit : l'heure affichée est un repère, pas
    // une horloge de sport. Au-delà, on réveille la radio pour rien.
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <StatusContext.Provider value={{ demo: backend.state === "offline", clock }}>
      {children}
    </StatusContext.Provider>
  );
}

/** Barre d'état mobile. La sidebar prend le relais au-dessus de 768 px. */
export function StatusBar({ path }: { path?: string }) {
  const { demo, clock } = useStatus();
  const pending = usePendingVisible();

  return (
    <div
      data-allow-tiny
      className="fixed inset-x-0 bottom-(--h-bottomnav) z-(--z-nav)
        h-(--h-status) border-t border-edge glass-strong shell:hidden
        rounded-(--radius-card)"
    >
      <div className="mx-auto flex h-full max-w-[560px] items-center gap-2 px-(--gutter)">
        {/* Le chemin ne s'affiche que s'il apprend quelque chose : une page
            qui ne le fournit pas (parce qu'il redirait le titre du bandeau)
            ne montre rien plutôt qu'un « ~ » de remplissage. */}
        {path && (
          <span className="label-micro flex min-w-0 items-center gap-1.5 text-chalk-4">
            <Icon name="terminal" size={11} />
            <span className="truncate">{path}</span>
          </span>
        )}

        {demo ? (
          <span className="label-micro ml-auto flex shrink-0 items-center gap-1
            rounded-full bg-signal px-2 py-px text-void">
            <Icon name="bolt" size={9} strokeWidth={2.4} />
            démo
          </span>
        ) : pending ? (
          /* Le réseau travaille : le mini-logo remplace la pastille,
             et sa boucle suit le vrai temps des requêtes (lib/pending). */
          <PendingStatus className="ml-auto" />
        ) : (
          /* La pastille « en ligne » respire. En mode démo, l'accent est
             déjà un aplat : ajouter un mouvement y serait du bruit. */
          <span className="label-micro ml-auto flex shrink-0 items-center gap-1 text-phosphor">
            <span className="mode-live block size-[5px] bg-phosphor" />
            en ligne
          </span>
        )}

        <span className="label-micro tnum shrink-0 text-chalk-4">{clock}</span>
      </div>
    </div>
  );
}
