# -*- coding: utf-8 -*-
"""scripts/build_kichub_svg.py — construit le logo KICHUB (refonte sobre).

Chaîne : props de `kichub_geom` → SVG maître (texte posé en vraie
fonte) → inkscape vectorise le texte en chemins → `logo/kichub.svg`
(light : fond transparent, K indigo) + `logo/kichub-dark.svg` (fond
sombre : K blanc, nœud magenta conservé) → PNG de contrôle.
"""

import pathlib
import subprocess
import sys
from PIL import ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import kichub_geom as g  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO = ROOT / "logo"
TMP = ROOT / ".tmp-logo"
TMP.mkdir(exist_ok=True)


# ── Mesure du texte pour le centrage ────────────────────────────────────
def font_path(name="Inter Display SemiBold"):
    cand = [
        "/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf",
        "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in cand:
        if pathlib.Path(p).exists():
            return p
    raise SystemExit("aucune borne Inter/DejaVu trouvée")


FPATH = font_path()
FONT = ImageFont.truetype(FPATH, g.wordmark()["size"])


def text_width(s, tracking):
    chars = list(s)
    w = FONT.getlength(s)
    return w + tracking * (len(chars) - 1)


# ── Assemblage du SVG maître ────────────────────────────────────────────
def path_d(pts):
    return "M " + " L ".join(f"{p[0]} {p[1]}" for p in pts)


def fit_viewbox(margin=30):
    """Gabarit resserré sur l'encre : bbox analytique + marge vierge."""
    CAP = FONT.getbbox("K")[3] - FONT.getbbox("K")[1]  # hauteur capitale
    xs, ys = [], []
    for prop in g.lockup():
        if prop["kind"] == "stroke":
            for pts in prop["pts"]:
                xs += [p[0] for p in pts]; ys += [p[1] for p in pts]
        elif prop["kind"] == "circle":
            x, y, r = prop["c"]; xs += [x - r, x + r]; ys += [y - r, y + r]
        else:  # texte
            tw = text_width(g.wordmark()["text"], g.wordmark()["tracking"])
            y = g.wordmark()["y"]
            xs += [g.W / 2 - tw / 2, g.W / 2 + tw / 2]
            ys += [y - CAP, y + CAP * 0.06]  # overshoot des rondes
    lo_x, hi_x = min(xs) - margin, max(xs) + margin
    lo_y, hi_y = min(ys) - margin, max(ys) + margin
    return lo_x, lo_y, hi_x - lo_x, hi_y - lo_y


def build_svg(letter, accent):
    wm = g.wordmark()
    tw = text_width(wm["text"], wm["tracking"])
    # le K est recentré sur le gabarit : bbox des extrémités du trait
    xs2 = [g.K_STEM[0][0] - g.SW / 2, g.K_UP[1][0] + g.SW / 2]
    cx = sum(xs2) / 2
    dx = g.W / 2 - cx
    body = []
    for prop in g.lockup(letter=letter, accent=accent):
        if prop["kind"] == "stroke":
            d = " ".join(path_d(pts) for pts in prop["pts"])
            body.append(
                f'<path d="{d}" stroke="{prop["stroke"]}" stroke-width="{prop["w"]}"'
                f' stroke-linecap="{prop["cap"]}" stroke-linejoin="round"'
                f' fill="none"/>'
            )
        elif prop["kind"] == "circle":
            x, y, r = prop["c"]
            body.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{prop["fill"]}"/>')
        elif prop["kind"] == "text":
            tx = g.W / 2 - tw / 2  # le texte est déjà centré sur W/2
            body.append(
                    f'<text x="{tx:.1f}" y="{wm["y"]}" font-family="Inter Display'
                    f' SemiBold, Inter, DejaVu Sans" font-weight="600"'
                    f' font-size="{wm["size"]}" letter-spacing="{wm["tracking"]}"'
                    f' fill="{prop["fill"]}">{wm["text"]}</text>'
                )
    # décalage global : le K est recalé pour que le lockup respire
    vx, vy, vw, vh = fit_viewbox()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vx:.0f} {vy:.0f} {vw:.0f} {vh:.0f}">'
        f'<g transform="translate({dx:.1f} 0)">{"".join(body)}</g></svg>'
    )


# ── Build ────────────────────────────────────────────────────────────────
def vectorize(master_path, out_path):
    """inkscape : texte → chemins, sortie aplat (pas d'attributs inutiles)."""
    subprocess.run(
        [
            "inkscape", str(master_path),
            "--export-text-to-path",
            "--export-plain-svg",
            f"--export-filename={out_path}",
        ],
        check=True, capture_output=True,
    )


def rasterize(svg_path, png_path, size=720):
    subprocess.run(
        [
            "inkscape", str(svg_path),
            f"--export-type=png", f"--export-filename={png_path}",
            # largeur seule : inkscape garde le ratio du viewBox
            f"--export-width={size}",
        ],
        check=True, capture_output=True,
    )


if __name__ == "__main__":
    # 1. SVG maître avec <text> (le centrage horizontal est calculé ici)
    master = build_svg(letter=g.ELEC, accent=g.MGNT)
    (TMP / "master.svg").write_text(master)

    # 2. vectorisation → logo/kichub.svg (clair) et logo/kichub-dark.svg
    vectorize(TMP / "master.svg", LOGO / "kichub.svg")
    dark = build_svg(letter=g.INK, accent=g.MGNT)
    (LOGO / "kichub-dark.svg").write_text(dark)

    # 3. PNG de contrôle
    rasterize(LOGO / "kichub.svg", ROOT / "logo" / "kichub-preview.png")
    print("OK — écrit :", *(p.name for p in LOGO.glob("kichub*")))
