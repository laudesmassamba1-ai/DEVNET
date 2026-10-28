"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { INTRO_SLIDES, TOUR_STOPS } from "@/lib/tour/steps";
import { useSession } from "@/hooks/useSession";
import { TourOverlay } from "./TourOverlay";

/**
 * La prise en main — l'état, la mémoire, et le déclenchement.
 *
 * ## Un seul passage, offert une seule fois
 *
 * La visite se lance **d'elle-même** une fois, après la première
 * connexion, puis se souvient d'être passée (`localStorage`). Elle reste
 * relançable à la main par le bouton « Revoir la visite » du profil : une
 * aide qu'on ne peut pas rappeler n'est pas une aide, c'est un accident.
 *
 * ## Pourquoi le drapeau d'auto-lancement est un `ref`
 *
 * Sans lui, chaque changement de session ou de page relancerait le
 * minuteur — et une navigation rapide pendant le délai d'attente le
 * relancerait indéfiniment. Le `ref` garantit « au plus une fois par
 * chargement d'application », ce que l'état `active` seul ne peut pas
 * dire (il retombe à `false` quand on ferme).
 */

const DONE_KEY = "devnet.tour.v1";

/**
 * Écrans publics : la visite ne s'y déclenche jamais, même connecté.
 *
 * L'accueil et la connexion se lisent sans guide — c'est le **produit**
 * qui parle, pas nous. La prise en main commence dans l'application.
 */
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/setup",
  "/preview-code",
  "/a-propos",
  "/cgu",
];

type Phase = "intro" | "tour";

interface TourValue {
  active: boolean;
  start: () => void;
  stop: () => void;
}

const TourContext = createContext<TourValue>({
  active: false,
  start: () => {},
  stop: () => {},
});

export function useTour() {
  return useContext(TourContext);
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useSession();
  const pathname = usePathname();

  const [phase, setPhase] = useState<Phase>("intro");
  const [slide, setSlide] = useState(0);
  const [stop, setStop] = useState(0);
  const [active, setActive] = useState(false);

  const launched = useRef(false);

  const open = useCallback(() => {
    setPhase("intro");
    setSlide(0);
    setStop(0);
    setActive(true);
  }, []);

  const close = useCallback(() => {
    setActive(false);
    try {
      window.localStorage.setItem(DONE_KEY, "done");
    } catch {
      // Stockage indisponible : la visite se reproposera au prochain
      // chargement. Gênant, jamais bloquant.
    }
  }, []);

  const next = useCallback(() => {
    if (phase === "intro") {
      if (slide < INTRO_SLIDES.length - 1) setSlide((s) => s + 1);
      else {
        setPhase("tour");
        setStop(0);
      }
      return;
    }
    if (stop < TOUR_STOPS.length - 1) setStop((s) => s + 1);
    else close();
  }, [phase, slide, stop, close]);

  const prev = useCallback(() => {
    if (phase === "tour") {
      if (stop > 0) setStop((s) => s - 1);
      else {
        setPhase("intro");
        setSlide(INTRO_SLIDES.length - 1);
      }
      return;
    }
    if (slide > 0) setSlide((s) => s - 1);
  }, [phase, slide, stop]);

  const skipIntro = useCallback(() => {
    setPhase("tour");
    setStop(0);
  }, []);

  // Auto-lancement — au plus une fois par chargement, sur un écran privé.
  useEffect(() => {
    if (launched.current) return;
    if (loading || !session || !profile) return;
    if (PUBLIC_ROUTES.includes(pathname)) return;

    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(DONE_KEY);
    } catch {
      // Stockage indisponible : on renonce à l'auto-lancement pour ne pas
      // imposer la visite à chaque rechargement.
      launched.current = true;
      return;
    }
    if (seen === "done") {
      launched.current = true;
      return;
    }

    const timer = setTimeout(() => {
      launched.current = true;
      open();
    }, 900);
    return () => clearTimeout(timer);
  }, [loading, session, profile, pathname, open]);

  return (
    <TourContext.Provider value={{ active, start: open, stop: close }}>
      {children}
      {active && (
        <TourOverlay
          phase={phase}
          slideIndex={slide}
          stopIndex={stop}
          onNext={next}
          onPrev={prev}
          onSkipIntro={skipIntro}
          onClose={close}
        />
      )}
    </TourContext.Provider>
  );
}
