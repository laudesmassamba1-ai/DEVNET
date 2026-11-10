"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/Icon";

/**
 * Guide visuel de création d’une extension.
 *
 * Volontairement **local** : aucun dépôt GitHub n’est contacté, aucune API
 * n’est appelée. L’habillage « dépôt » sert à montrer les fichiers et les
 * gestes réels, pas à simuler un service. Les étapes décrivent le mécanisme
 * qui existe aujourd’hui (manifeste, publication, activation, contributions),
 * pas le SDK de la Phase 2.
 */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(callback: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  );
}

interface Step {
  id: string;
  label: string;
  file: string;
  hint: string;
  code: string;
  preview: React.ReactNode;
}

const JSON_MANIFEST = `{
  "snippets": [
    {
      "language": "typescript",
      "prefix": "dnet-composant",
      "body": "export function Nom() { … }"
    }
  ],
  "commands": [
    {
      "id": "test-plan",
      "title": "Insérer un plan de tests",
      "body": "// Tests à écrire : …"
    }
  ],
  "settings": [
    {
      "key": "maxLineLength",
      "label": "Longueur de ligne maximale",
      "type": "number",
      "default": 88
    }
  ],
  "slots": [
    {
      "slot": "discover.sidebar",
      "title": "Kit de démarrage actif",
      "href": "/extensions"
    }
  ]
}`;

const FIELDS = [
  ["Nom", "Kit de démarrage DevNet"],
  ["Description", "Extraits, commandes, réglage et cartes."],
  ["Version", "1.1.0"],
  ["Catégorie", "Extraits"],
] as const;

/** Texte tapé lettre à lettre ; le texte complet est affiché si le mouvement est réduit. */
function TypedCode({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? text : ""));

  useEffect(() => {
    if (reduced) return;
    let length = 0;
    const timer = window.setInterval(() => {
      length = Math.min(text.length, length + 4);
      setShown(text.slice(0, length));
      if (length >= text.length) window.clearInterval(timer);
    }, 14);
    return () => window.clearInterval(timer);
  }, [text, reduced]);

  return (
    <pre
      aria-hidden="true"
      className="min-h-[300px] overflow-x-auto whitespace-pre p-3.5 font-mono text-[11.5px]
        leading-[1.65] text-chalk-2"
    >
      {reduced ? text : shown}
      {!reduced && <span className="text-signal">▍</span>}
    </pre>
  );
}

export function ExtensionGuide() {
  const [step, setStep] = useState(0);
  const baseId = useId();

  const steps: Step[] = [
    {
      id: "declarer",
      label: "Déclarer",
      file: "manifest.json",
      hint: "Un seul fichier JSON décrit tout ce que l’extension apporte. Aucun code n’est exécuté.",
      code: JSON_MANIFEST,
      preview: (
        <ul className="space-y-2 text-[12.5px] text-chalk-3">
          {[
            ["Extraits", "2 préfixes de complétion"],
            ["Commandes", "2 entrées de palette F1"],
            ["Réglages", "1 valeur persistée"],
            ["Cartes", "2 emplacements nommés"],
          ].map(([title, detail]) => (
            <li key={title} className="flex items-baseline justify-between gap-3 border-b border-line-2 pb-2">
              <span className="font-bold text-chalk">{title}</span>
              <span className="text-right text-chalk-4">{detail}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "publier",
      label: "Publier",
      file: "formulaire",
      hint: "Dans Extensions, le bouton « + » ouvre le formulaire. Les champs ci-dessous sont ceux de l’écran réel.",
      code: FIELDS.map(([label, value]) => `${label.padEnd(12)} ${value}`).join("\n") + `

Puis : Publier
→ l’extension apparaît dans la place de marché`,
      preview: (
        <div className="space-y-2">
          {FIELDS.map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-input)] border border-line-3 bg-surface px-3 py-2">
              <p className="label-micro text-chalk-4">{label}</p>
              <p className="mt-0.5 text-[13px] text-chalk">{value}</p>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "activer",
      label: "Activer",
      file: "activation",
      hint: "Installer active immédiatement. Désactiver retire les cartes et les contributions, sans supprimer les réglages.",
      code: `1. Extensions → Installer
2. L’état passe à « Activée »
3. Désactiver → les cartes disparaissent
4. Réinstaller → les réglages reviennent`,
      preview: (
        <div className="space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-chip)] border
            border-line-3 bg-surface px-3 py-2 text-[12px] font-bold text-chalk">
            <Icon name="check" size={12} /> Activée
          </span>
          <p className="text-[12.5px] leading-relaxed text-chalk-3">
            Une extension désactivée reste installée : ses données et ses réglages
            sont conservés, mais elle ne contribue plus rien à l’interface.
          </p>
        </div>
      ),
    },
    {
      id: "agir",
      label: "Où ça agit",
      file: "contributions",
      hint: "Les contributions n’apparaissent que dans des emplacements prévus par le cœur.",
      code: `slot  discover.sidebar   → carte dans Découvrir
slot  extensions.page    → carte dans Extensions
prefix dnet-readme       → complétion dans l’IDE
palette F1               → « Insérer un plan de tests »`,
      preview: (
        <ul className="space-y-2.5">
          {[
            ["Découvrir", "Carte « Kit de démarrage actif » dans la barre latérale."],
            ["IDE", "Tape dnet-readme puis Tab : le README se déploie."],
            ["Palette F1", "« Insérer un plan de tests » écrit le plan au curseur."],
            ["Réglages", "La longueur de ligne est enregistrée par installation."],
          ].map(([title, detail]) => (
            <li key={title} className="rounded-[var(--radius-input)] border border-line-2 bg-surface p-2.5">
              <p className="label-micro text-signal">{title}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-chalk-3">{detail}</p>
            </li>
          ))}
        </ul>
      ),
    },
  ];

  const current = steps[step];

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="rounded-[var(--radius-card)] border border-line-2 bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 px-3.5 py-2.5">
        <p id={`${baseId}-title`} className="label-micro text-chalk-2">
          Créer une extension · guide
        </p>
        <span className="rounded-[var(--radius-chip)] border border-dashed border-line-2 px-2 py-1
          text-[10px] font-bold uppercase tracking-[0.08em] text-chalk-4">
          Aperçu local
        </span>
      </div>

      <div className="grid lg:grid-cols-2">
        <div className="min-w-0 border-b border-line-2 lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-2 border-b border-line-2 px-3 py-2">
            <span className="flex size-6 items-center justify-center rounded-full border border-line-3
              text-[10px] font-bold text-chalk-4">
              dn
            </span>
            <p className="min-w-0 truncate font-mono text-[11.5px] text-chalk-3">
              devnet / extensions / <span className="text-chalk">kit-demarrage</span>
            </p>
            <span className="ml-auto rounded-[var(--radius-chip)] border border-line-2 px-2 py-0.5
              font-mono text-[10px] text-chalk-4">
              main
            </span>
          </div>

          <div className="flex gap-0">
            <ul aria-label="Fichiers du guide" className="w-[118px] shrink-0 border-r border-line-2 py-2">
              {steps.map((s, index) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(index)}
                    aria-current={step === index ? "true" : undefined}
                    className={`flex min-h-11 w-full items-center gap-1.5 px-2.5 text-left
                      font-mono text-[11px] transition-colors
                      ${step === index
                        ? "bg-surface-2 text-signal"
                        : "text-chalk-4 hover:text-chalk-2"}`}
                  >
                    <Icon name={index === 0 ? "code" : index === 3 ? "grid" : "package"} size={12} />
                    <span className="truncate">{s.file}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0 flex-1">
              <TypedCode key={current.id} text={current.code} />
            </div>
          </div>
        </div>

        <div className="min-w-0 p-3.5">
          <p className="label-micro text-chalk-4">Ce que ça change à l’écran</p>
          <div className="mt-3">{current.preview}</div>
          <p className="mt-3 border-t border-line-2 pt-3 text-[12px] leading-relaxed text-chalk-4">
            {current.hint}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line-2 px-3.5 py-2.5">
        <div role="tablist" aria-label="Étapes du guide" className="flex flex-wrap gap-1.5">
          {steps.map((s, index) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={step === index}
              onClick={() => setStep(index)}
              className={`min-h-11 rounded-[var(--radius-chip)] border px-3 text-[11.5px] font-bold
                transition-colors ${step === index
                  ? "border-line-3 bg-signal text-void"
                  : "border-line-2 bg-surface text-chalk-3 hover:text-chalk"}`}
            >
              {index + 1}. {s.label}
            </button>
          ))}
        </div>
        <p className="ml-auto font-mono text-[10.5px] text-chalk-4">
          {step + 1} / {steps.length}
        </p>
      </div>
    </section>
  );
}
