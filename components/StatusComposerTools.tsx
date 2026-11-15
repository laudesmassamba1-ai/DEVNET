"use client";

/**
 * Barres sous la scène. Une seule rangée de réglages change selon l'outil :
 * dessin (couleur, épaisseur), texte sélectionné (taille, couleur, alignement,
 * pastille), sticker (grille). Le pied de page garde les gestes d'ajout et
 * de style, chacun désactivé avec sa raison quand le média ne le permet pas.
 */
import { Icon } from "@/components/Icon";
import { Setting, Swatch, ToolItem } from "@/components/StatusComposerControls";
import {
  ALIGN_LABEL,
  FILTERS,
  INK_LABEL,
  INK_VARS,
  PEN_COLORS,
  STICKER_GLYPHS,
  STROKE_LABEL,
  TEXT_SIZE_LABEL,
  ZOOM_LABEL,
  type Align,
  type TextLayer,
} from "@/lib/status-editor-model";

export type ContextProps = {
  tool: "move" | "draw";
  onStopDrawing: () => void;
  penColor: number;
  onPenColor: (index: number) => void;
  penWidth: number;
  onPenWidth: (index: number) => void;
  selectedText: TextLayer | null;
  onPatchText: (patch: Partial<TextLayer>) => void;
  hasSelection: boolean;
  onRemoveSelected: () => void;
  stickersOpen: boolean;
  onSticker: (glyph: string) => void;
};

/** Réglages du contexte courant : dessin, texte, stickers ou rien. */
export function StatusComposerContext(props: ContextProps) {
  const { tool, selectedText, stickersOpen } = props;

  if (tool === "draw") {
    return (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-2 bg-surface/95 px-3 py-1.5" role="group" aria-label="Réglages du dessin">
        <div className="flex items-center gap-1">
          {PEN_COLORS.map((index) => (
            <Swatch
              key={index}
              label={INK_LABEL[index]}
              cssVar={INK_VARS[index]}
              selected={props.penColor === index}
              onClick={() => props.onPenColor(index)}
            />
          ))}
        </div>
        <div className="flex flex-1 items-center gap-1.5">
          {STROKE_LABEL.map((label, index) => (
            <Setting
              key={label}
              label={label}
              hint="Épaisseur"
              icon="pen"
              active={props.penWidth === index}
              onClick={() => props.onPenWidth(index)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={props.onStopDrawing}
          className="min-h-(--h-tap) rounded-(--radius-chip) bg-signal/15 px-3 text-12 font-semibold text-signal"
        >
          Terminer
        </button>
      </div>
    );
  }

  if (stickersOpen) {
    return (
      <div className="grid grid-cols-5 gap-1 border-t border-line-2 bg-surface/95 px-3 py-1.5" role="group" aria-label="Stickers">
        {STICKER_GLYPHS.map((glyph) => (
          <button
            key={glyph}
            type="button"
            onClick={() => props.onSticker(glyph)}
            aria-label={`Ajouter le sticker ${glyph}`}
            className="flex min-h-(--h-tap) items-center justify-center rounded-(--radius-chip) text-2xl hover:bg-surface-2"
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        ))}
      </div>
    );
  }

  if (selectedText) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line-2 bg-surface/95 px-3 py-1.5" role="group" aria-label="Réglages du texte">
        <Setting
          label={TEXT_SIZE_LABEL[selectedText.size]}
          hint="Taille"
          icon="grid"
          active={selectedText.size > 0}
          onClick={() => props.onPatchText({ size: (selectedText.size + 1) % TEXT_SIZE_LABEL.length })}
        />
        <Setting
          label={INK_LABEL[selectedText.color]}
          hint="Couleur"
          icon="sun"
          active={selectedText.color > 0}
          onClick={() => props.onPatchText({ color: (selectedText.color + 1) % INK_VARS.length })}
        />
        <Setting
          label={ALIGN_LABEL[selectedText.align]}
          hint="Alignement"
          icon="align"
          active={selectedText.align !== 1}
          onClick={() => props.onPatchText({ align: ((selectedText.align + 1) % 3) as Align })}
        />
        <Setting
          label={selectedText.pill ? "Pastille" : "Nu"}
          hint="Fond du texte"
          icon="droplet"
          active={selectedText.pill}
          onClick={() => props.onPatchText({ pill: !selectedText.pill })}
        />
        <DeleteButton onClick={props.onRemoveSelected} />
      </div>
    );
  }

  if (props.hasSelection) {
    return (
      <div className="flex justify-end border-t border-line-2 bg-surface/95 px-3 py-1.5">
        <DeleteButton onClick={props.onRemoveSelected} />
      </div>
    );
  }

  return null;
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-(--h-tap) items-center gap-1.5 rounded-(--radius-chip) border border-line-3 px-3 text-12 font-semibold text-danger hover:border-danger"
    >
      <Icon name="trash" size={14} />
      Supprimer
    </button>
  );
}

export type FooterProps = {
  audience: string;
  onAudience: (value: "public" | "followers" | "private") => void;
  /** Raison d'un média qui ne se retouche pas (vidéo, GIF), sinon `undefined`. */
  mediaReason?: string;
  isPhoto: boolean;
  hasGif: boolean;
  hasSource: boolean;
  filter: number;
  zoom: number;
  background: number;
  onMedia: () => void;
  onGif: () => void;
  onRemoveMedia: () => void;
  onText: () => void;
  onDraw: () => void;
  onSticker: () => void;
  onBackground: () => void;
  onFilter: () => void;
  onZoom: () => void;
  drawing: boolean;
  stickersOpen: boolean;
};

/** Pied de page : public, puis les gestes d'ajout et de style. */
export function StatusComposerFooter(props: FooterProps) {
  const layerDisabled = Boolean(props.mediaReason);
  const layerTitle = props.mediaReason;
  const styleLocked = props.hasSource || props.hasGif;

  return (
    <footer className="shrink-0 border-t border-line-2 bg-surface/95 px-2 pb-1.5 pt-1">
      <div role="radiogroup" aria-label="Qui peut voir ce statut" className="mx-auto mb-1 flex max-w-xl gap-1.5">
        {([
          ["public", "Public"],
          ["followers", "Abonnés"],
          ["private", "Moi"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={props.audience === value}
            onClick={() => props.onAudience(value)}
            className={`min-h-11 flex-1 rounded-input border px-2 font-mono text-12 transition-colors ${props.audience === value ? "border-signal bg-signal/10 text-signal" : "border-line-2 text-chalk-3 hover:border-line-3"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mx-auto flex max-w-xl items-stretch">
        <ToolItem label="Média" icon="image" onClick={props.onMedia} />
        <ToolItem label="GIF" icon="gif" active={props.hasGif} onClick={props.onGif} />
        <ToolItem label="Texte" icon="text" onClick={props.onText} />
        <ToolItem
          label="Dessin"
          icon="pen"
          active={props.drawing}
          disabled={layerDisabled}
          title={layerTitle ?? "Dessiner sur le statut"}
          onClick={props.onDraw}
        />
        <ToolItem
          label="Sticker"
          icon="sticker"
          active={props.stickersOpen}
          disabled={layerDisabled}
          title={layerTitle ?? "Ajouter un sticker"}
          onClick={props.onSticker}
        />
      </div>

      <div className="mx-auto mt-1 flex max-w-xl items-stretch gap-1.5 border-t border-line-2 pt-1.5">
        <Setting
          label={props.background > 0 ? `Fond ${props.background + 1}` : "Fond 1"}
          hint="Fond"
          icon="droplet"
          disabled={styleLocked}
          onClick={props.onBackground}
        />
        <Setting
          label={FILTERS[props.filter].label}
          hint="Filtre"
          icon="filter"
          active={props.filter > 0}
          disabled={layerDisabled}
          onClick={props.onFilter}
        />
        <Setting
          label={ZOOM_LABEL[props.zoom]}
          hint="Cadrage"
          icon="crop"
          active={props.zoom > 0}
          disabled={!props.isPhoto}
          onClick={props.onZoom}
        />
      </div>
      {styleLocked ? (
        <p className="mt-1 flex items-center justify-center gap-2 text-12 leading-tight text-chalk-3">
          Le fond est remplacé par le média.
          <button type="button" onClick={props.onRemoveMedia} className="font-semibold text-signal underline underline-offset-2">
            Retirer le média
          </button>
        </p>
      ) : null}
      {layerTitle ? <p className="mt-1 text-center text-12 leading-tight text-chalk-3">{layerTitle}</p> : null}
    </footer>
  );
}
