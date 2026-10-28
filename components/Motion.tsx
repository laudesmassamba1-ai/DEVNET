"use client";

import { createElement, useEffect, useRef, useState, useCallback } from "react";

/* ────────────────────────────────────────────────────────────────────────────
   Motion — système de mouvement DevNet.

   Principe : `Motion` n'ajoute **aucun élément** dans le DOM. Il applique la
   classe d'animation directement sur l'élément rendu (polymorphe via `as`).

   Pourquoi c'est important : un composant d'animation qui enveloppe son
   enfant dans un `<div>` casse toutes les dispositions en flex ou grid —
   la gouttière d'un post, une ligne de liste, une cellule de grille. Le
   mouvement doit être une **propriété** de l'élément, pas un conteneur.

   Les durées, courbes et keyframes vivent dans `app/globals.css`, classées
   par intention (`entrance`, `spring`, `continuous`, `timing`). Ce fichier
   ne fait que l'orchestration : rôle, retard, cascade.
   ──────────────────────────────────────────────────────────────────────────── */

/** Rôles d'animation. Chacun correspond à une grammaire de mouvement. */
export type MotionRole =
  /** Fondu simple — pour le texte secondaire. */
  | "fade"
  /** Ascension + fondu — le défaut : un contenu qui arrive. */
  | "slide"
  /** Ascension avec léger recul — pour les panneaux et cartes. */
  | "rise"
  /** Apparition par l'échelle — pour les surfaces (sheet, carte). */
  | "scale"
  /** Émergence par le flou — la « matière » d'iOS qui se dépose, sans
      glissement. Réservé aux surfaces uniques (héros, en-têtes) : le coût
      du filtre n'est payé qu'une fois, jamais par une liste. */
  | "soft"
  /** Entrée avec une rotation de 4° — pour les marques et prompts. */
  | "rotate"
  /** Retrait — pour les éléments qui sortent. */
  | "exit"
  /** Rebond de compteur — quand une valeur numérique change. */
  | "pop"
  /** Élévation au survol. */
  | "lift"
  /** Compression au clic. */
  | "press"
  /** Rotation continue. */
  | "spin"
  /** Opacité pulsée. */
  | "pulse"
  /** Respiration (échelle + opacité). */
  | "breathe"
  /** Balayage vertical. */
  | "scan"
  /** Éclat d'une réaction posée — l'emoji qui s'appose. */
  | "burst"
  /** Refus : deux secousses, sans déplacement final. */
  | "deny"
  /** Montée d'une feuille depuis le bas du plan de travail. */
  | "sheet"
  /** Assombrissement du voile derrière une feuille. */
  | "veil"
  /** Aucune animation — utile sous `prefers-reduced-motion`. */
  | "none";

/** Table des rôles → classes CSS. Volontairement déclarative. */
const ROLE_CLASS: Record<MotionRole, string> = {
  fade: "mo-fade",
  slide: "mo-slide",
  rise: "mo-rise",
  scale: "mo-scale",
  soft: "mo-soft",
  rotate: "mo-rotate",
  exit: "mo-exit",
  pop: "mo-pop",
  lift: "mo-lift",
  press: "mo-press",
  spin: "mo-spin",
  pulse: "mo-pulse",
  breathe: "mo-breathe",
  scan: "mo-scan",
  burst: "mo-burst",
  deny: "mo-deny",
  sheet: "mo-sheet",
  veil: "mo-veil",
  none: "",
};

/**
 * Retards par rôle, appliqués automatiquement quand aucun `delay` n'est
 * donné. C'est ce qui produit la choreographie : un enfant plus profond
 * arrive plus tard, donc l'œil suit une ligne de lecture.
 */
const ROLE_BASE_DELAY: Record<MotionRole, number> = {
  fade: 0,
  slide: 0,
  rise: 0,
  scale: 0,
  soft: 0,
  rotate: 0,
  exit: 0,
  pop: 0,
  lift: 0,
  press: 0,
  spin: 0,
  pulse: 0,
  breathe: 0,
  scan: 0,
  burst: 0,
  deny: 0,
  sheet: 0,
  veil: 0,
  none: 0,
};

export interface MotionProps {
  children?: React.ReactNode;
  /** Rôle du mouvement. */
  role?: MotionRole;
  /** Retard explicite (ms). Prioritaire sur le retard par rôle. */
  delay?: number;
  /**
   * Elemento rendu. Par défaut `div`.
   *
   * `form` est proposé parce que l'inscription multi-étapes a besoin
   * que le <form> soit lui-même animé : sans cela, il faudrait soit
   * abdiquer l'entrée, soit interdire à l'utilisateur d'appuyer sur
   * Entrée — ce qui est un défaut fonctionnel, pas un détail de style.
   *
   * `h1` et `main` sont proposés pour la même raison, en plus forte : ce
   * sont les deux balises qui portent le sens de la page. Animer un
   * `div` et le nommer `h1` à côté, ou l'inverse, casse soit le document
   * outline, soit l'animation d'entrée — et le premier est invisible pour
   * la personne qui navigue au clavier ou au lecteur d'écran.
   */
  as?: "div" | "span" | "section" | "article" | "li" | "header" | "figure" | "form" | "h1" | "main";
  className?: string;
  style?: React.CSSProperties;
  /** Accessibilité : lu par les lecteurs d'écran. */
  "aria-hidden"?: boolean;
  /** Pour `as="form"`. */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  /** Bouton submit implicite, utile pour les formulaires à un champ. */
  type?: "button" | "submit" | "reset";
  /** Attributs HTML additionnels (id, role, aria-*, data-*). */
  attrs?: Record<string, unknown>;
}

/**
 * Applique un mouvement d'entrée sur l'élément lui-même.
 *
 * ```tsx
 * <Motion role="rise" delay={80} as="span">…</Motion>
 * ```
 *
 * Pour une cascade, on utilise `<Stagger>` : le même mouvement, retardé
 * d'un cran par enfant.
 */
export function Motion({
  children,
  role = "slide",
  delay,
  as = "div",
  className = "",
  style,
  attrs,
  ...rest
}: MotionProps) {
  const ms = delay ?? ROLE_BASE_DELAY[role];

  // `createElement` plutôt qu'une balise dynamique : TypeScript ne peut
  // pas vérifier le type d'événement selon une balise choisie à
  // l'exécution, et un `any` ne ferait que déplacer l'erreur à
  // l'exécution. Ici le contrat reste explicite à l'appel.
  return createElement(
    as,
    {
      className: `${ROLE_CLASS[role]} ${className}`.trim() || undefined,
      style: { ...style, animationDelay: `${ms}ms` },
      // `attrs` est étalé **avant** le reste : un `id` ou un `title`
      // passé ici doit gagner sur la valeur par défaut du composant, et
      // non l'inverse. Sans cet ordre, `Motion` acceptait `attrs` et
      // l'ignorait — un attribut qui semble écrit et ne l'est pas, la
      // pire des deux situations : le code l'affirmait et rien ne
      // se passait.
      ...attrs,
      ...rest,
    },
    children,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Stagger — cascade d'un même mouvement sur une liste.

   Le retard est calculé par rang, mais **plafonné** : au-delà de
   `maxDelay`, les éléments restants apparaissent ensemble. Sans ce
   plafond, le vingtième élément d'un fil mettrait trois secondes à
   apparaître — l'utilisateur aurait déjà compris la page.
   ──────────────────────────────────────────────────────────────────────────── */
export function Stagger({
  children,
  /** Nombre d'enfants (reçu automatiquement par `StaggerList`). */
  index = 0,
  step = 60,
  maxDelay = 600,
  role = "rise",
  as: Tag = "div",
  className = "",
  style,
}: MotionProps & { index?: number; step?: number; maxDelay?: number }) {
  const ms = Math.min(index * step, maxDelay);

  return (
    <Tag
      className={`${ROLE_CLASS[role]} ${className}`.trim() || undefined}
      style={{ ...style, animationDelay: `${ms}ms` }}
    >
      {children}
    </Tag>
  );
}

/** Divers utilitaires pour composer une cascade à la main. */
export const cascade = (index: number, step = 60, max = 600): number =>
  Math.min(index * step, max);

/* ────────────────────────────────────────────────────────────────────────────
   Tilt — inclinaison 3D pilotée par le pointeur.

   ## Pourquoi ce composant ajoute un élément, alors que `Motion` n'en
   ajoute jamais

   Une animation d'entrée (`mo-rise`) porte déjà un `transform`, et avec
   `animation-fill-mode: both` elle **conserve** sa valeur finale une fois
   terminée. Une règle d'animation a priorité sur une transformation écrite
   en ligne : poser l'inclinaison sur le même élément que l'animation
   donnerait donc un élément qui ne bouge jamais, sans qu'aucune erreur ne
   le dise. Il faut deux éléments — l'extérieur anime, l'intérieur incline.

   ## Pourquoi l'angle est minuscule

   La profondeur n'est pas un décor, c'est une **réaction** : 6° au
   maximum, et seulement à la souris (`pointerType === "mouse"`), jamais
   au doigt. Un effet de carte qui suit le doigt transforme un défilement
   en tremblement. Sous `prefers-reduced-motion`, l'inclinaison s'arrête
   complètement — c'est la seule animation qu'on ne peut pas cesser par le
   CSS seul, puisqu'elle dépend du JavaScript.

   ## Pourquoi l'inertie lit la vitesse du pointeur

   La carte est un objet posé, pas un aimant : avec une durée de
   transition fixe, elle répond au pas — un balayage rapide et une
   micro-dérive se ressemblaient, à précision égale. La vitesse lissée
   du pointeur choisit le **jeton de poursuite** (`--tilt-d`) : dérive
   lente → `--d-fast` (collée), dérive normale → `--d-base` (demi-pas),
   balayage rapide → `--d-slow` (traîne et se rattrape). Le retrait
   repose sur `--d-slow` : le retour est le mouvement le plus lourd de
   tous. La durée tient **en jetons** — le composant ne pose aucun ordre
   de grandeur, seul le seuil de vitesse (sans unité) est sien.
   ──────────────────────────────────────────────────────────────────────────── */
export function Tilt({
  children,
  className = "",
  max = 6,
}: {
  children: React.ReactNode;
  className?: string;
  /** Angle maximal, en degrés. Petit par construction. */
  max?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);

  /* Inertie : la carte n'est pas un aimant, c'est un objet pesé. La
     vitesse du pointeur décide à quelle hâte elle suit — mais jamais
     à quel angle : le maximum reste celui du design, au cm près. */

  /** Position et instant du dernier événement, pour la dérivée. */
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Vitesse lissée (px/ms) : une moyenne mobile, donc une seule
      aberration de latence OS ne l'étire pas. */
  const speed = useRef(0);

  /**
   * *Référence de vitesse* — à combien un « geste rapide » est posé.
   *
   * Une dérive posée de la souris fait 0,2-0,5 px/ms ; un balayage
   * traversant la carte en ~200 ms fait 2-3 px/ms. Cette borne est
   * sans unité : ce n'est pas une durée, elle échappe donc à la
   * règle « pas de durée en dur ».
   */
  const SWEEP_SPEED_PXMS = 2;

  const trackDuration = () => {
    const el = ref.current;
    if (!el) return;
    /* La vitesse choisit le jeton de **poursuite** — la durée de la
       transition qui repose l'angle à chaque événement, la seule
       façon stable pour un navigateur de faire « traîner » une carte :
       - quasi immobile  → `--d-fast` : elle suit de près, presque collée ;
       - dérive normale  → `--d-base` : elle suit avec un demi-pas ;
       - balayage rapide → `--d-slow` : elle traîne et se rattrape —
         c'est ce retard-là qu'on sent sur un objet pesé. */
    const weight = speed.current / SWEEP_SPEED_PXMS;
    if (weight > 0.75) el.style.setProperty("--tilt-d", "var(--d-slow)");
    else if (weight > 0.25) el.style.setProperty("--tilt-d", "var(--d-base)");
    else el.style.setProperty("--tilt-d", "var(--d-fast)");
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType !== "mouse") return;

    const el = ref.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    // Vitesse instantanée depuis le dernier événement, puis lissée.
    // `dt` de 0 possible à haute fréquence d'horloge, d'où la garde :
    // une seule motion exceptionnelle ne saturera pas l'EMA.
    const prev = last.current;
    if (prev) {
      const dt = e.timeStamp - prev.t;
      if (dt > 0) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        const instant = Math.hypot(dx, dy) / dt;
        speed.current = speed.current * 0.7 + Math.min(instant, SWEEP_SPEED_PXMS * 3) * 0.3;
        trackDuration();
      }
    }
    last.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };

    // Position relative au centre : −0,5 à gauche, +0,5 à droite.
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;

    // Survoler le haut incline la carte vers l'arrière : le `rotateX` est
    // donc l'**opposé** de la position verticale.
    el.style.setProperty("--tilt-y", `${(px * max).toFixed(2)}deg`);
    el.style.setProperty("--tilt-x", `${(-py * max).toFixed(2)}deg`);
  };

  const reset = () => {
    const el = ref.current;
    if (!el) return;
    // Reprise de vitesse au prochain survol, et pas avec l'ancienne : la
    // carte repose au retrait avec la portion d'inertie la plus lourde —
    // elle repose pour de bon.
    last.current = null;
    speed.current = 0;
    el.style.setProperty("--tilt-d", "var(--d-slow)");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  };

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={reset}
      onPointerCancel={reset}
      className={`tilt-3d ${className}`.trim()}
      style={{
        transform:
          "perspective(720px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg))",
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Sortie — retenir une ligne le temps de son animation de retrait.

   Une animation de sortie ne peut rien faire d'elle-même : au moment où
   React retire l'élément, il n'est plus dans le document, et une animation
   sur un élément absent ne se voit pas. Il faut donc **retarder le
   retrait** — c'est tout ce que fait `waitForExit`.

   On ne fournit pas de crochet `useExit` : un crochet par ligne est
   impossible, puisque le nombre de lignes change et que React interdit un
   nombre variable de crochets. Les pages marquent donc l'élément qui part,
   attendent, puis le retirent — trois lignes explicites, sans abstraction
   à déboguer.

   La durée est **lue dans le jeton CSS** plutôt que recopiée : si
   `--d-fast` change, l'attente suit. Une valeur recopiée ici finirait
   par diverger de l'animation, et le symptôme — un élément qui clignote ou
   qui disparaît trop tard — ne se voit pas dans le code.
   ──────────────────────────────────────────────────────────────────────────── */

/** Durée de repli si le jeton est introuvable (SSR, navigateur ancien). */
const EXIT_FALLBACK_MS = 140;

/** Lit une durée d'animation (`--d-fast`) et la rend en millisecondes. */
export function motionDuration(token: string, fallback: number): number {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }

  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!raw) return fallback;

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return fallback;

  // `140ms` → 140 ; `0.14s` → 140.
  return raw.endsWith("ms") ? value : value * 1000;
}

/**
 * Attend la fin d'une animation de sortie.
 *
 * Sous `prefers-reduced-motion` il n'y a rien à attendre : l'animation est
 * neutralisée par le CSS, donc attendre ne ferait que ralentir le retrait
 * d'un délai arbitraire — le retrait devient instantané, ce qui est le but.
 */
export async function waitForExit(token = "--d-fast"): Promise<void> {
  if (typeof window === "undefined") return;

  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const ms = motionDuration(token, EXIT_FALLBACK_MS);
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/* ────────────────────────────────────────────────────────────────────────────
   useInView — anime à l'approche du regard, pas au chargement.

   Sans ça, un fil de quarante posts déclenche quarante animations à la
   navigation : la page « pulse » pendant une seconde et demie avant de
   become lisible. On n'anime que ce qui entre réellement dans le champ.
   ──────────────────────────────────────────────────────────────────────────── */
export function useInView({
  threshold = 0.08,
  rootMargin = "0px 0px -8% 0px",
  once = true,
  delay = 0,
}: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
  delay?: number;
} = {}) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Pas d'IntersectionObserver (tests, navigateurs anciens, mode
    // serveur) : on montre immédiatement. Une animation perdue vaut mieux
    // qu'un contenu invisible.
    if (typeof IntersectionObserver === "undefined") {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin, once]);

  return {
    ref,
    inView,
    /** Classes à poser : masqué avant l'entrée, animé après. */
    className: inView ? ROLE_CLASS.rise : "mo-pre",
    delay,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   usePrefersReducedMotion — laisse la décision au CSS, expose l'info
   pour les cas où le JavaScript doit en tenir compte (timers, springs).
   ──────────────────────────────────────────────────────────────────────────── */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(query.matches);

    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/* ────────────────────────────────────────────────────────────────────────────
   useCount — compteur animé de 0 à la valeur cible.

   Un score qui passe de 1400 à 1820 doit être vu comme une progression,
   pas comme un saut. L'animation compte en `requestAnimationFrame` avec
   une courbe d'accélération douce, et s'arrête net si l'utilisateur
   préfère moins de mouvement.
   ──────────────────────────────────────────────────────────────────────────── */
export function useCount(target: number, durationMs = 700): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const fromRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduced) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // `easeOutCubic` : départ rapide, arrivée douce. Un compteur
      // linéaire donne l'impression de(compiler.
      const eased = 1 - (1 - t) ** 3;
      const current = Math.round(from + delta * eased);
      setValue(current);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, reduced]);

  return value;
}

/* ────────────────────────────────────────────────────────────────────────────
   useHoverMotion — état de survol partagé pour les cartes.

   Le survol d'une carte pilote à la fois la carte, sa bordure et son
   ombre. Passé en JS (et non en CSS pur) parce que le retard de la
   bordure est lui-même animé : le filet « rattrape » la carte.
   ──────────────────────────────────────────────────────────────────────────── */
export function useHoverMotion() {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const exit = useCallback(() => setHovered(false), []);
  return { hovered, enter, exit };
}