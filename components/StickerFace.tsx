/**
 * Un sticker, quelle que soit sa matière.
 *
 * Un glyphe du catalogue de la maison garde ses jetons de couleur vides :
 * il s'affiche comme avant, sans pastille. Une image est servie par la
 * route d'actif, jamais par une data URL — les octets ne transitent pas
 * dans le DOM.
 *
 * Extrait du lecteur de stories pour être réutilisé par le sélecteur de
 * sticker de la messagerie : deux rendus différents du même objet
 * finiraient par diverger.
 */
export function StickerFace({
  kind,
  glyph,
  fg,
  bg,
  assetId,
  builtin,
  size,
  alt = "",
}: {
  kind: "texte" | "image" | "animé";
  glyph: string;
  fg: string;
  bg: string;
  assetId: string;
  /** Image embarquée (`public/stickers/<builtin>.svg`) — repli de démo. */
  builtin?: string;
  size: number;
  alt?: string;
}) {
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={
          builtin
            ? `/stickers/${encodeURIComponent(builtin)}.svg`
            : `/api/stickers/${encodeURIComponent(assetId)}/asset`
        }
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        className="rounded-[26%] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden={alt ? undefined : true}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className="inline-flex items-center justify-center rounded-[26%]"
      style={{
        width: fg && bg ? size : undefined,
        height: fg && bg ? size : undefined,
        backgroundColor: fg && bg ? `var(--color-${bg})` : "transparent",
        color: fg ? `var(--color-${fg})` : "inherit",
        fontSize: size * 0.66,
      }}
    >
      {glyph}
    </span>
  );
}
