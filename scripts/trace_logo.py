# -*- coding: utf-8 -*-
"""scripts/trace_logo.py — reconstruction vectorielle du logo KICHUB.

La source (`logo/KICHUB_transparent-.png`, 159 × 226) est un PNG aux bords
antialiasés : chaque couche y est un nuancier mélangé. La première étape est
donc une quantification aux sept tons pleins de la palette (plus proche
voisin en RGB, sur les pixels dont l'alpha annonce une matière réelle),
puis une marche des contours par couche, une simplification
Douglas-Peucker, et l'écriture d'un JSON de tracés.

Sorties :
- <out>/kichub-traces.json  — { couche: [ [ [x,y], ... ] (boucles fermées) ] }
- <out>/kichub-map.txt      — carte ASCII de la quantification (contrôle)
- sur stdout : les statistiques de chaque couche (boucles, points, bbox)

La coordonnée produite vit dans l'espace de la SOURCE (0..159, 0..226) :
c'est elle que consomment `build_kichub_svg.py` puis `build_lottie.py`.

Ce script est déterministe : relancé, il produit la même chose. Il n'a
pas de dépendance hors numpy/Pillow (déjà là pour le projet).
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# ── La palette de départ — les sept tons pleins de la source ────────────
# Toutes les valeurs sont relevées pixel par pixel sur le PNG (tolérance
# de ±40 en RGB). Les tons intermédiaires (110,56,197), (61,10,183)… se
# rangent par plus proche voisin : ce sont des frontières d'antialias,
# pas des couleurs de design.
PALETTE = {
    "electrique":  (37, 5, 183),     # peau, corps
    "profond":     (18, 5, 172),     # ombre de la peau (tone cel)
    "pasteur":     (153, 125, 255),  # lumière (patte, rim)
    "violet_moy":  (75, 5, 194),     # transition lumière↔peau
    "magenta":     (224, 56, 209),   # cadre, joues, signets
    "magenta_omb": (134, 27, 209),   # ombre du magenta (tone cel)
    "cyan":        (125, 255, 240), # contacteur, type-C
    "blanc":       (255, 255, 255), # K sur le dos, traces, wordmark
}

SCALE = 6          # survol des masques : la marche des contours y respire
RDP_EPS = 5.0      # en px *SCALE* : 5/6 px source — l'image reste fidèle
ALPHA_MIN = 120    # sous ce seuil : antialias ou halo, pas de matière

SRC = Path("logo/KICHUB_transparent-.png")
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/kichub")


def nearest_class(c):
    """La classe dont le ton plein est le plus proche en RGB."""
    best, bd = None, 1e9
    for name, base in PALETTE.items():
        d = (c[0] - base[0]) ** 2 + (c[1] - base[1]) ** 2 + (c[2] - base[2]) ** 2
        if d < bd:
            best, bd = name, d
    return best


def quantize(png):
    """La source → sept masques binaires à l'échelle SCALE."""
    rgba = np.asarray(png, dtype=np.int16)
    h, w, _ = rgba.shape
    alpha = rgba[..., 3]
    masks = {name: np.zeros((h * SCALE, w * SCALE), dtype=bool) for name in PALETTE}
    cls_map = np.empty((h, w), dtype=object)
    cls_map[...] = None
    for y in range(h):
        for x in range(w):
            a = alpha[y, x]
            if a < ALPHA_MIN:
                continue
            cls = nearest_class((rgba[y, x, 0], rgba[y, x, 1], rgba[y, x, 2]))
            cls_map[y, x] = cls
            m = masks[cls]
            m[y * SCALE:(y + 1) * SCALE, x * SCALE:(x + 1) * SCALE] = True
    return masks, cls_map, (w, h)


def trace(mask):
    """Marche des contours : toutes les boucles fermées d'un masque bool.

    Convention : chaque bord unité est orienté pour laisser l'intérieur
    à sa droite. Aux points ambigus (deux couleurs qui se touchent en
    diagonale produisent un coin à quatre bords), on vire **le plus à
    droite possible** : c'est ce qui fait longer le même composant au
    lieu de traverser — et décomposer la marche en boucles propres.
    Vérifié empiriquement sur les sept couches : sans ce tri, la
    traversée d'un coin consomme un bord étranger et la marche se coince.
    """
    H, W = mask.shape

    def turn_right(d):
        # En y descendant, virer à droite visuel : (dx,dy) → (-dy,dx)
        dx, dy = d
        return (-dy, dx)

    out_edges = {}   # point de départ -> [points d'arrivée]
    for y in range(H):
        row = mask[y]
        for x in range(W):
            if not row[x]:
                continue
            up = y == 0 or not mask[y - 1, x]
            dn = y == H - 1 or not mask[y + 1, x]
            lf = x == 0 or not mask[y, x - 1]
            rt = x == W - 1 or not mask[y, x + 1]
            if up:
                out_edges.setdefault((x, y), []).append((x + 1, y))
            if rt:
                out_edges.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if dn:
                out_edges.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if lf:
                out_edges.setdefault((x, y + 1), []).append((x, y))

    def rank(option, at_point, incoming):
        """0 : virer à droite ; 1 : tout droit ; 2 : à gauche ; 3 : demi-tour."""
        d = (option[0] - at_point[0], option[1] - at_point[1])
        if d == turn_right(incoming):
            return 0
        if d == incoming:
            return 1
        dx, dy = incoming
        if d == turn_right((-dx, -dy)):
            return 2
        return 3

    loops = []
    while out_edges:
        # On démarre sur n'importe quel bord restant : un point de départ
        # à deux bords est un coin ambigu, et le tri ci-dessous le gère.
        start, cands = next((k, v) for k, v in out_edges.items() if v)
        nxt = cands.pop()
        if not cands:
            del out_edges[start]
        loop = [start, nxt]
        incoming = (nxt[0] - start[0], nxt[1] - start[1])
        while nxt != start:
            options = out_edges.get(nxt)
            if not options:
                raise RuntimeError(
                    f"boucle ouverte : coincé au point {nxt}, "
                    "voir la convention de virage")
            if len(options) == 1:
                pick = options.pop()
            else:
                options.sort(key=lambda q: rank(q, nxt, incoming))
                pick = options.pop(0)
            if not options:
                del out_edges[nxt]
            prev = nxt
            nxt = pick
            loop.append(nxt)
            incoming = (nxt[0] - prev[0], nxt[1] - prev[1])
        loop.pop()               # le retour au point de départ, déjà bouclé
        loops.append(loop)
    return loops


def rdp(points, eps):
    """Douglas-Peucker en boucle fermée (le premier point sert d'ancre)."""
    if len(points) < 4:
        return points
    n = len(points)
    pts = points + [points[0]]
    keep = {0, n}
    stack = [(0, n)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        max_d, best = -1.0, -1
        for k in range(i + 1, j):
            x0, y0 = pts[k]
            if norm == 0:
                d = math.hypot(x0 - x1, y0 - y1)
            else:
                d = abs(dy * (x0 - x1) - dx * (y0 - y1)) / norm
            if d > max_d:
                max_d, best = d, k
        if max_d > eps:
            keep.add(best)
            stack.append((i, best))
            stack.append((best, j))
    out = [points[k] for k in sorted(k % n for k in keep)]
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    png = Image.open(SRC).convert("RGBA")
    masks, cls_map, (w, h) = quantize(png)

    # carte ASCII de contrôle (un caractère par pixel source)
    sym = {"electrique": "I", "profond": "P", "pasteur": "L",
           "violet_moy": "V", "magenta": "M", "magenta_omb": "m",
           "cyan": "C", "blanc": "W"}
    lines = []
    for y in range(h):
        line = "".join(sym.get(cls_map[y, x], ".") for x in range(w))
        lines.append(line)
    (OUT / "kichub-map.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("carte ASCII :", OUT / "kichub-map.txt")

    traces = {}
    for name, mask in masks.items():
        loops = trace(mask)
        simplified = [rdp(loop, RDP_EPS) for loop in loops]
        simplified = [l for l in simplified if len(l) >= 3]
        xs = [p[0] for l in simplified for p in l]
        ys = [p[1] for l in simplified for p in l]
        bbox = (min(xs) / SCALE, min(ys) / SCALE,
                max(xs) / SCALE, max(ys) / SCALE) if xs else None
        traces[name] = [[[p[0] / SCALE, p[1] / SCALE] for p in l] for l in simplified]
        print(f"{name:14s} boucles={len(simplified):3d} "
              f"points={sum(len(l) for l in simplified):5d} bbox={bbox}")

    (OUT / "kichub-traces.json").write_text(
        json.dumps(traces, separators=(",", ":")), encoding="utf-8")
    print("tracés :", OUT / "kichub-traces.json")


if __name__ == "__main__":
    main()
