"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { INTRO_SLIDES, TOUR_STOPS } from "@/lib/tour/steps";

/**
 * La couche visuelle de la prise en main.
 *
 * Deux temps dans un seul composant, parce qu'ils partagent le même cadre
 * et le même portail : l'**intro illustrée** (trois cartes centrées, sans
 * cible) puis la **visite des vraies pages** (projecteur sur un élément,
 * bulle accrochée à côté). La mécanique d'état vit dans `TourProvider` ;
 * ici on ne fait que mesurer, positionner et peindre.
 *
 * ## Pourquoi un portail, et pourquoi on mesure à part
 *
 * Le projecteur doit échapper aux `transform` et `backdrop-filter` des
 * ancêtres — les mêmes raisons que `Sheet` (un `position: fixed` dans un
 * parent transformé se retrouve encastré). Il vit donc dans
 * `document.body`.
 *
 * La cible, elle, appartient à la page : elle peut être sous la ligne de
 * flottaison, dans une colonne qui défile, ou pas encore montée après une
 * navigation. On la cherche donc **après** le rendu, en boucle bornée, et
 * on remesure à chaque défilement ou redimensionnement. Une cible
 * absente n'est pas une erreur : la bulle se pose au centre et explique
 * quand même la section.
 */

const VEIL = "rgba(20, 22, 17, 0.58)";
const PAD = 8;

function findVisible(target: string): HTMLElement | null {
  const els = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`),
  );
  // Un `data-tour` peut exister deux fois (barre basse **et** explorateur,
  // l'un étant masqué selon la largeur). On prend le premier réellement
  // affiché — un élément `display: none` a un rectangle nul.
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return els[0] ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function computeBulb(
  rect: DOMRect | null,
  placement: "auto" | "top" | "bottom" | "left" | "right" | undefined,
  bulbH: number,
) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 14;
  const gap = 14;
  const mobile = vw < 640;
  const width = mobile ? vw - m * 2 : Math.min(368, vw - m * 2);
  const height = Math.max(bulbH, 180);

  if (!rect) {
    return { left: (vw - width) / 2, top: Math.max(m, vh / 2 - height / 2), width };
  }

  let place = placement ?? "auto";
  if (place === "auto") {
    // L'explorateur est une colonne haute et à gauche → la bulle va à
    // droite. La barre basse est hors de l'écran vers le bas → au-dessus.
    const isSide = rect.left < vw * 0.32 && rect.height > vh * 0.45;
    const atBottom = rect.bottom > vh * 0.62;
    place = isSide ? "right" : atBottom ? "top" : "bottom";
  }

  if (place === "right" || place === "left") {
    const left =
      place === "right"
        ? Math.min(rect.right + gap, vw - width - m)
        : Math.max(m, rect.left - gap - width);
    return {
      left,
      top: clamp(rect.top + rect.height / 2 - height / 2, m, vh - height - m),
      width,
    };
  }

  const spaceBelow = vh - rect.bottom - gap;
  const spaceAbove = rect.top - gap;
  let below = place === "bottom";
  if (below && spaceBelow < height && spaceAbove > spaceBelow) below = false;
  if (!below && spaceAbove < height && spaceBelow > spaceAbove) below = true;

  const top = below
    ? Math.min(rect.bottom + gap, vh - height - m)
    : Math.max(m, rect.top - gap - height);
  const left = clamp(rect.left + rect.width / 2 - width / 2, m, vw - width - m);
  return { left, top, width };
}

export interface TourOverlayProps {
  phase: "intro" | "tour";
  slideIndex: number;
  stopIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onSkipIntro: () => void;
  onClose: () => void;
}

export function TourOverlay({
  phase,
  slideIndex,
  stopIndex,
  onNext,
  onPrev,
  onSkipIntro,
  onClose,
}: TourOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [monte, setMonte] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonte(true);
  }, []);

  const [rect, setRect] = useState<DOMRect | null>(null);
  const bulbRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const [bulbSize, setBulbSize] = useState({ w: 360, h: 210 });

  const stop = phase === "tour" ? TOUR_STOPS[stopIndex] : null;
  const slide = phase === "intro" ? INTRO_SLIDES[slideIndex] : null;

  const total = TOUR_STOPS.length;
  const stopKey = stop ? stop.id : "intro";

  // ── Naviguer vers l'écran de l'arrêt, puis mesurer la cible ───────────
  useEffect(() => {
    if (!stop || !stop.target) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null);
      return;
    }
    let alive = true;
    const target = stop.target;

    const wait = async (): Promise<HTMLElement | null> => {
      const deadline = Date.now() + 3000;
      let el = findVisible(target);
      while (!el && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 90));
        if (!alive) return null;
        el = findVisible(target);
      }
      return el;
    };

    void (async () => {
      if (pathname !== stop.route) {
        router.push(stop.route);
        await new Promise((r) => setTimeout(r, 140));
      }
      const el = await wait();
      if (!alive) return;
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "auto" });
      await new Promise((r) => setTimeout(r, 70));
      if (!alive) return;
      setRect(el.getBoundingClientRect());
    })();

    return () => {
      alive = false;
    };
  }, [stop, stopKey, pathname, router]);

  // ── Rester aligné si la page bouge sous la bulle ──────────────────────
  useEffect(() => {
    if (!stop?.target) return;
    const target = stop.target;
    const update = () => {
      const el = findVisible(target);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [stop, stopKey]);

  // ── Mesurer la bulle pour la poser sans la tronquer ───────────────────
  useLayoutEffect(() => {
    const el = bulbRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBulbSize((prev) =>
      Math.abs(prev.h - r.height) > 2 || Math.abs(prev.w - r.width) > 2
        ? { w: r.width, h: r.height }
        : prev,
    );
  }, [phase, slideIndex, stopIndex, rect]);

  // ── Clavier : flèches et échap ────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrev, onClose]);

  // ── Donner le focus au bouton principal à chaque étape ────────────────
  // Sans cela, un lecteur d'écran ou un usage clavier reste sur le bouton
  // de l'étape précédente — qui vient d'être démonté. On vise « Suivant » :
  // c'est l'action attendue, et Entrée l'enclenche sans souris.
  useEffect(() => {
    const t = setTimeout(() => primaryRef.current?.focus({ preventScroll: true }), 80);
    return () => clearTimeout(t);
  }, [phase, slideIndex, stopIndex]);

  const bulbStyle = useMemo(() => {
    if (!monte || phase === "intro") return null;
    return computeBulb(rect, stop?.placement, bulbSize.h);
  }, [monte, phase, rect, stop, bulbSize.h]);

  if (!monte) return null;

  // ────────────────────────────────────────────────────────────────────
  //  Intro illustrée
  // ────────────────────────────────────────────────────────────────────
  if (phase === "intro" && slide) {
    const last = slideIndex === INTRO_SLIDES.length - 1;
    return createPortal(
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center overlay-veil p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Prise en main de DevNet"
      >
        <div
          ref={bulbRef}
          className="depth-panel overlay-panel w-full max-w-[460px] rounded-[var(--radius-card)]
            border border-edge px-6 py-7 shadow-[var(--shadow-drop-lg)]"
        >
          <span
            className="mb-5 flex size-14 items-center justify-center rounded-[var(--radius-input)]
              border border-signal bg-signal/15 text-signal-d"
          >
            <Icon name={slide.icon} size={24} strokeWidth={1.7} />
          </span>

          <p className="label-micro mb-2 text-signal-d">{slide.eyebrow}</p>
          <h2 className="font-display text-[1.4rem] font-bold leading-tight tracking-[-0.02em] text-chalk">
            {slide.title}
          </h2>
          <p className="mt-2.5 text-[13.5px] leading-[1.65] text-chalk-2">{slide.body}</p>

          {slide.points && (
            <ul className="mt-4 flex flex-col gap-2">
              {slide.points.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-[13px] leading-snug text-chalk-3">
                  <span className="mt-[3px] text-signal">
                    <Icon name="check" size={12} strokeWidth={2.4} />
                  </span>
                  {pt}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              {INTRO_SLIDES.map((s, i) => (
                <span
                  key={s.title}
                  className={`size-1.5 rounded-full transition-colors duration-[var(--d-fast)]
                    ${i === slideIndex ? "bg-signal" : "bg-chalk-4/40"}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={onSkipIntro}
              className="ml-auto rounded-[var(--radius-input)] border border-transparent px-3
                text-[12.5px] font-bold text-chalk-3 transition-colors hover:text-chalk"
            >
              Passer
            </button>

            {slideIndex > 0 && (
              <button
                type="button"
                onClick={onPrev}
                className="mo-press rounded-[var(--radius-input)] border border-line-3 px-4
                  text-[12.5px] font-bold text-chalk transition-colors hover:border-signal hover:text-signal"
              >
                Précédent
              </button>
            )}

            <button
              type="button"
              ref={primaryRef}
              onClick={onNext}
              className="mo-press flex h-[var(--h-tap)] items-center gap-2 rounded-[var(--radius-input)]
                border border-signal bg-signal px-4 text-[12.5px] font-bold text-void shadow-sh-2"
            >
              {last ? "Commencer la visite" : "Suivant"}
              <Icon name="chevron-right" size={12} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ────────────────────────────────────────────────────────────────────
  //  Visite des vraies pages
  // ────────────────────────────────────────────────────────────────────
  if (phase === "tour" && stop) {
    const last = stopIndex === total - 1;
    return createPortal(
      <div
        className="fixed inset-0 z-[var(--z-modal)]"
        role="dialog"
        aria-modal="true"
        aria-label="Visite guidée de DevNet"
      >
        {rect ? (
          <div
            className="pointer-events-none absolute"
            style={{
              left: rect.left - PAD,
              top: rect.top - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              borderRadius: 16,
              boxShadow: `0 0 0 3px var(--color-signal), 0 0 0 9999px ${VEIL}`,
              transition:
                "left var(--d-slow) var(--ease-spring), top var(--d-slow) var(--ease-spring), width var(--d-slow) var(--ease-spring), height var(--d-slow) var(--ease-spring)",
            }}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: VEIL }} />
        )}

        <div
          ref={bulbRef}
          style={{
            position: "fixed",
            left: bulbStyle?.left,
            top: bulbStyle?.top,
            width: bulbStyle?.width,
            transition: "left var(--d-slow) var(--ease-spring), top var(--d-slow) var(--ease-spring)",
          }}
          className="depth-panel overlay-panel rounded-[var(--radius-card)] border border-edge
            p-4 shadow-[var(--shadow-drop-lg)]"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-input)] bg-signal/15 text-signal-d">
              <Icon name={stop.icon} size={14} strokeWidth={1.9} />
            </span>
            <h2 className="font-display text-[15px] font-bold tracking-[-0.01em] text-chalk">
              {stop.title}
            </h2>
            <span className="tnum ml-auto font-mono text-[10.5px] text-chalk-4">
              {stopIndex + 1}/{total}
            </span>
          </div>

          <div
            className="mb-3 h-[3px] overflow-hidden rounded-full bg-chalk-4/25"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={stopIndex + 1}
            aria-label="Progression de la visite"
          >
            <div
              className="h-full rounded-full bg-signal transition-[width] duration-[var(--d-slow)] ease-out"
              style={{ width: `${((stopIndex + 1) / total) * 100}%` }}
            />
          </div>

          <p className="text-[13px] leading-[1.6] text-chalk-2">{stop.body}</p>

          <div className="mt-3.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius-input)] border border-transparent px-2.5
                text-[12px] font-bold text-chalk-3 transition-colors hover:text-chalk"
            >
              Quitter
            </button>

            <span className="ml-auto flex items-center gap-2">
              {stopIndex > 0 && (
                <button
                  type="button"
                  onClick={onPrev}
                  className="mo-press flex h-9 items-center gap-1.5 rounded-[var(--radius-input)]
                    border border-line-3 px-3 text-[12px] font-bold text-chalk
                    transition-colors hover:border-signal hover:text-signal"
                >
                  <Icon name="chevron-left" size={12} strokeWidth={2.2} />
                  Précédent
                </button>
              )}
              <button
                type="button"
                ref={primaryRef}
                onClick={onNext}
                className="mo-press flex h-9 items-center gap-1.5 rounded-[var(--radius-input)]
                  border border-signal bg-signal px-3.5 text-[12px] font-bold text-void shadow-sh-2"
              >
                {last ? "Terminer" : "Suivant"}
                {!last && <Icon name="chevron-right" size={12} strokeWidth={2.2} />}
              </button>
            </span>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return null;
}
