"use client";

/**
 * Inspecteur de calque.
 *
 * Un seul panneau, groupé par intention : transformation, contenu, matière,
 * réglages. Chaque champ porte un nom accessible — les entrées numériques
 * sont le chemin clavier des gestes à la souris, donc elles ne sont pas un
 * doublon : elles sont l'alternative.
 *
 * Les couleurs sont **des jetons**, jamais des valeurs : un texte choisi
 * aujourd'hui suit le thème de demain.
 */
import {
  INK_TOKENS,
  NO_FILTERS,
  isFiltered,
  type Layer,
  type MediaLayer,
  type ShapeLayer,
  type TextLayer,
} from "@/lib/studio/editor";

const MIN_SIZE = 4;

export function StudioInspector({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (next: Partial<Layer>) => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <SectionTitle>Transformation</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X %" value={layer.x} onChange={(x) => onChange({ x })} />
          <NumberField label="Y %" value={layer.y} onChange={(y) => onChange({ y })} />
          <NumberField
            label="Largeur %"
            value={layer.w}
            min={MIN_SIZE}
            onChange={(w) => onChange({ w })}
          />
          <NumberField
            label="Hauteur %"
            value={layer.h}
            min={MIN_SIZE}
            onChange={(h) => onChange({ h })}
          />
          <NumberField
            label="Rotation °"
            value={layer.rotation}
            onChange={(rotation) => onChange({ rotation })}
          />
          <NumberField
            label="Opacité %"
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            onChange={(opacity) => onChange({ opacity: opacity / 100 })}
          />
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-chalk-2">
          <input
            type="checkbox"
            checked={layer.locked}
            onChange={(event) => onChange({ locked: event.target.checked })}
            className="size-4"
          />
          Verrouiller
        </label>
      </section>

      {layer.type === "text" && (
        <section>
          <SectionTitle>Texte</SectionTitle>
          <textarea
            value={layer.text}
            onChange={(event) => onChange({ text: event.target.value })}
            rows={3}
            aria-label="Contenu du texte"
            className="mb-2 w-full resize-none rounded-md border border-line-2 bg-surface-2 px-2 py-1.5 text-sm text-chalk"
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Corps" value={layer.size} min={8} onChange={(size) => onChange({ size })} />
            <NumberField
              label="Interligne"
              value={layer.lineHeight}
              step={0.05}
              onChange={(lineHeight) => onChange({ lineHeight })}
            />
            <NumberField
              label="Interlettre"
              value={layer.letterSpacing}
              step={0.01}
              onChange={(letterSpacing) => onChange({ letterSpacing })}
            />
            <SelectField
              label="Graisse"
              value={String(layer.weight)}
              options={[
                ["400", "400"],
                ["500", "500"],
                ["600", "600"],
                ["700", "700"],
              ]}
              onChange={(value) => onChange({ weight: Number(value) })}
            />
            <SelectField
              label="Police"
              value={layer.font}
              options={[
                ["display", "Titre"],
                ["sans", "Texte"],
                ["mono", "Mono"],
              ]}
              onChange={(value) => onChange({ font: value as TextLayer["font"] })}
            />
            <SelectField
              label="Alignement"
              value={layer.align}
              options={[
                ["left", "Gauche"],
                ["center", "Centre"],
                ["right", "Droite"],
              ]}
              onChange={(value) => onChange({ align: value as TextLayer["align"] })}
            />
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-chalk-2">
            <input
              type="checkbox"
              checked={layer.uppercase}
              onChange={(event) => onChange({ uppercase: event.target.checked })}
              className="size-4"
            />
            Capitales
          </label>
          <Swatches value={layer.color} onPick={(color) => onChange({ color })} />
        </section>
      )}

      {layer.type === "shape" && (
        <section>
          <SectionTitle>Forme</SectionTitle>
          <SelectField
            label="Type"
            value={layer.shape}
            options={[
              ["rect", "Rectangle"],
              ["ellipse", "Ellipse"],
              ["line", "Trait"],
            ]}
            onChange={(value) => onChange({ shape: value as ShapeLayer["shape"] })}
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="Rayon"
              value={layer.radius}
              min={0}
              onChange={(radius) => onChange({ radius })}
            />
            <NumberField
              label="Contour"
              value={layer.strokeWidth}
              min={0}
              onChange={(strokeWidth) => onChange({ strokeWidth })}
            />
          </div>
          <Swatches value={layer.fill} onPick={(fill) => onChange({ fill })} />
        </section>
      )}

      {(layer.type === "image" || layer.type === "video" || layer.type === "sticker") && (
        <section>
          <SectionTitle>Média</SectionTitle>
          <SelectField
            label="Cadrage"
            value={layer.fit}
            options={[
              ["cover", "Remplir"],
              ["contain", "Contenir"],
            ]}
            onChange={(value) => onChange({ fit: value as MediaLayer["fit"] })}
          />
          <div className="mt-2">
            <NumberField
              label="Rayon"
              value={layer.radius}
              min={0}
              onChange={(radius) => onChange({ radius })}
            />
          </div>
        </section>
      )}

      <section>
        <SectionTitle
          action={
            isFiltered(layer.filters) ? (
              <button
                type="button"
                onClick={() => onChange({ filters: { ...NO_FILTERS } })}
                className="text-signal hover:underline"
              >
                Réinitialiser
              </button>
            ) : null
          }
        >
          Réglages
        </SectionTitle>
        <div className="space-y-2">
          <Slider
            label="Lumière"
            value={layer.filters.brightness}
            min={0.2}
            max={2}
            step={0.01}
            onChange={(brightness) => onChange({ filters: { ...layer.filters, brightness } })}
          />
          <Slider
            label="Contraste"
            value={layer.filters.contrast}
            min={0.2}
            max={2}
            step={0.01}
            onChange={(contrast) => onChange({ filters: { ...layer.filters, contrast } })}
          />
          <Slider
            label="Saturation"
            value={layer.filters.saturation}
            min={0}
            max={2}
            step={0.01}
            onChange={(saturation) => onChange({ filters: { ...layer.filters, saturation } })}
          />
          <Slider
            label="Flou"
            value={layer.filters.blur}
            min={0}
            max={30}
            step={0.5}
            onChange={(blur) => onChange({ filters: { ...layer.filters, blur } })}
          />
          <Slider
            label="Noir et blanc"
            value={layer.filters.grayscale}
            min={0}
            max={100}
            step={1}
            onChange={(grayscale) => onChange({ filters: { ...layer.filters, grayscale } })}
          />
          <Slider
            label="Sépia"
            value={layer.filters.sepia}
            min={0}
            max={100}
            step={1}
            onChange={(sepia) => onChange({ filters: { ...layer.filters, sepia } })}
          />
        </div>
      </section>
    </div>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <h3 className="mb-2 flex items-center justify-between font-mono text-xs font-bold uppercase tracking-wide text-chalk-4">
      {children}
      {action}
    </h3>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-chalk-3">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="h-8 w-full rounded-md border border-line-2 bg-surface-2 px-1.5 text-xs text-chalk"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-chalk-3">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-line-2 bg-surface-2 px-1.5 text-xs text-chalk"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-chalk-3">
        {label}
        <span className="font-mono text-chalk-4">{Number(value.toFixed(2))}</span>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </label>
  );
}

function Swatches({
  value,
  onPick,
}: {
  value: string;
  onPick: (token: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {INK_TOKENS.map((token) => (
        <button
          key={token}
          type="button"
          onClick={() => onPick(`var(${token})`)}
          aria-label={`Couleur ${token.replace("--color-", "")}`}
          aria-pressed={value === `var(${token})`}
          className={`size-6 rounded-md border ${
            value === `var(${token})` ? "border-chalk" : "border-line-2"
          }`}
          style={{ background: `var(${token})` }}
        />
      ))}
    </div>
  );
}
