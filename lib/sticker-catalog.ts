/**
 * Catalogue de la maison — repli de démonstration.
 *
 * En mode démonstration forcé, il n'y a pas de base : la route
 * `/api/stickers` interroge un dépôt qui n'existe pas encore et échoue.
 * Ce repli sert alors le catalogue embarqué, sous forme d'**images**
 * (`kind: "image"`), jamais de glyphes : un sticker est un média, pas un
 * caractère — un emoji dans une bulle, c'est du texte, et il ne se comporte
 * ni comme une image ni comme un sticker.
 *
 * Les identifiants sont des uuid stables, et `builtin` porte le nom du
 * fichier : `StickerFace` résout cette forme vers `public/stickers/<nom>.svg`,
 * et un message de démonstration qui les référence reste lisible après
 * rechargement.
 *
 * Le repli n'est servi que si `NEXT_PUBLIC_FORCE_DEMO=true` : en
 * production, une base injoignable doit rester une panne visible.
 */
import type { StickerRowView } from "./stickers";

type HouseSticker = { name: string; label: string };

const HOUSE: HouseSticker[] = [
  { name: "etoile", label: "Étoile" },
  { name: "eclair", label: "Éclair" },
  { name: "check", label: "Validé" },
  { name: "coeur", label: "Cœur" },
  { name: "fleche", label: "Flèche" },
  { name: "etincelle", label: "Étincelle" },
];

export const HOUSE_STICKERS: StickerRowView[] = HOUSE.map((sticker, index) => ({
  // Un uuid stable dérivé de l'ordre : le catalogue ne bouge pas, et les
  // messages déjà écrits continuent de pointer sur la bonne image.
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  builtin: sticker.name,
  pack: "maison",
  kind: "image",
  glyph: "",
  name: sticker.label,
  visibility: "public",
  status: "actif",
  fg: "",
  bg: "",
  mine: false,
  byteSize: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
}));

export function houseStickersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FORCE_DEMO === "true";
}
