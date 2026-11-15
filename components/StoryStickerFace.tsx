/**
 * Un sticker, quelle que soit sa matière. Un glyphe du catalogue de la maison
 * garde ses jetons de couleur vides : il s'affiche comme avant, sans pastille.
 */
export function StoryStickerFace({
  kind,
  glyph,
  fg,
  bg,
  assetId,
  size,
}: {
  kind: "texte" | "image" | "animé";
  glyph: string;
  fg: string;
  bg: string;
  assetId: string;
  size: number;
}) {
  if (kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/stickers/${encodeURIComponent(assetId)}/asset`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="rounded-[26%] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
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
