# -*- coding: utf-8 -*-
"""scripts/build_lottie.py — les deux animations Lottie du logo KICHUB.

Entrée : `scripts/kichub_geom.py` (K monoline, nœud, couleurs) **et**
`logo/kichub.svg` — le wordmark est lu dans le SVG vectorisé par
inkscape : une seule source de vérité, zéro lettre redessinée ici.

Sorties :
- `logo/kichub-anim-A.lottie.json` — **Le tracé** (one-shot) : la hampe
  du K se trace, les deux jambes montent ensemble, le nœud magenta
  pointe, puis le mot s'élève du dessous. Sobre, ≈ 3 s.
- `logo/kichub-anim-B.lottie.json` — **Connecté** (boucle) : le lockup
  est posé, immobile ; seul le nœud bat et deux ondes de connexion
  partent du nœud. Deux cycles exacts de 45 trames → boucle parfaite.

Durées et courbes vivent dans cette source (livrables de marque).
"""

import json
import re
from pathlib import Path

import kichub_geom as G
import build_kichub_svg as BSV

OUT_A = Path("logo/kichub-anim-A.lottie.json")
OUT_B = Path("logo/kichub-anim-B.lottie.json")

FPS = 30
FR_A = 96          # 3,2 s
FR_B = 90          # deux cycles de 45 trames (1,5 s) → boucle exacte

CONT = (0.45, 0.0, 0.55, 1.0)
SPRING = (0.2, 0.8, 0.2, 1.0)

# ── Primitives Lottie ─────────────────────────────────────────────────────


def hex_rgb(h):
    h = h.lstrip("#")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]


def ease(n=1, spec=CONT):
    x0, y0, x1, y1 = spec
    return {"o": {"x": [x0] * n, "y": [y0] * n},
            "i": {"x": [x1] * n, "y": [y1] * n}}


def prop(pairs, n=1, spec=CONT):
    """Propriété animée : [(frame, valeur), …] ; tout `s` est un tableau."""
    ks = []
    for i, (t, v) in enumerate(pairs):
        s = v if isinstance(v, list) else [v]
        if len(s) == 1 and n > 1:
            s = s * n
        kf = {"t": t, "s": s}
        if i < len(pairs) - 1:
            kf.update(ease(n, spec))
        ks.append(kf)
    return {"a": 1, "k": ks}


def static(v):
    return {"a": 0, "k": v}


# ── Lecture des chemins SVG (relatif → absolu, tout fondu en C) ──────────

_NUM = r"-?\d*\.?\d+(?:e[-+]?\d+)?"
_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2}


def segments_absolute(d):
    """`d` (abs. comme rel.) → [(départ, [segments]), …], arcs interdits.

    Un segment = ("L", end) ou ("C", c1, c2, end), en coordonnées brutes
    du `d` (le translate du gabarit est cuit après, dans `subpaths_…`).
    """
    toks = re.findall(rf"[A-Za-z]|{_NUM}", d)
    subs = []            # chaque sous-chemin = [départ, *segments]
    cur = None
    last_c2 = None       # pour S et T : miroir du second point de contrôle
    big = None
    rel = False

    def nums(k):
        nonlocal i
        out = []
        while len(out) < k:
            if i >= len(toks):
                raise ValueError(f"path tronqué : {d[:60]}…")
            tk = toks[i]
            if re.fullmatch(_NUM, tk):
                out.append(float(tk)); i += 1
            elif tk.isalpha():
                raise ValueError(f"commande dans les nombres : {d[:60]}…")
            else:
                i += 1
        return out

    i = 0
    while i < len(toks):
        tk = toks[i]
        if tk.isalpha():
            cmd = tk.upper()
            if cmd == "A":
                raise ValueError("arc : non géré ici")
            big = "L" if cmd == "Z" else cmd
            rel = tk.islower()
            i += 1
            if cmd == "Z" and cur is not None:
                cur = subs[-1][0]        # fermeture : retour au départ
            continue
        if big is None:
            raise ValueError(f"nombre sans commande : {d[:60]}…")
        a = nums(_ARITY[big])
        if big == "M":
            base = cur if cur is not None else (0.0, 0.0)   # m initial ∈ R²
            p = (base[0] + a[0], base[1] + a[1]) if rel else (a[0], a[1])
            cur = p; last_c2 = None
            subs.append([p])
            big = "L"                    # suite de M implicite
        elif big == "L":
            p = (cur[0] + a[0], cur[1] + a[1]) if rel else (a[0], a[1])
            subs[-1].append(("L", p)); cur = p; last_c2 = None
        elif big == "H":
            x = cur[0] + a[0] if rel else a[0]
            p = (x, cur[1])
            subs[-1].append(("L", p)); cur = p; last_c2 = None
        elif big == "V":
            y = cur[1] + a[0] if rel else a[0]
            p = (cur[0], y)
            subs[-1].append(("L", p)); cur = p; last_c2 = None
        elif big == "C":
            if rel:
                p1 = (cur[0] + a[0], cur[1] + a[1])
                p2 = (cur[0] + a[2], cur[1] + a[3])
                p3 = (cur[0] + a[4], cur[1] + a[5])
            else:
                p1, p2, p3 = (a[0], a[1]), (a[2], a[3]), (a[4], a[5])
            subs[-1].append(("C", p1, p2, p3))
            cur = p3; last_c2 = p2
        elif big == "S":
            if rel:
                p2, p3 = (cur[0] + a[0], cur[1] + a[1]), \
                         (cur[0] + a[2], cur[1] + a[3])
            else:
                p2, p3 = (a[0], a[1]), (a[2], a[3])
            p1 = (2 * cur[0] - last_c2[0], 2 * cur[1] - last_c2[1]) \
                if last_c2 else cur
            subs[-1].append(("C", p1, p2, p3))
            cur = p3; last_c2 = p2
        elif big == "Q":
            if rel:
                qp1, qp2 = (cur[0] + a[0], cur[1] + a[1]), \
                           (cur[0] + a[2], cur[1] + a[3])
            else:
                qp1, qp2 = (a[0], a[1]), (a[2], a[3])
            c1 = tuple(v + 2 / 3 * (s - v) for v, s in zip(cur, qp1))
            c2 = tuple(v + 2 / 3 * (s - v) for v, s in zip(qp2, qp1))
            subs[-1].append(("C", c1, c2, qp2))
            cur = qp2; last_c2 = c2
        elif big == "T":
            qp2 = (cur[0] + a[0], cur[1] + a[1]) if rel else (a[0], a[1])
            qp1 = (2 * cur[0] - last_c2[0], 2 * cur[1] - last_c2[1]) \
                if last_c2 else cur
            c1 = tuple(v + 2 / 3 * (s - v) for v, s in zip(cur, qp1))
            c2 = tuple(v + 2 / 3 * (s - v) for v, s in zip(qp2, qp1))
            subs[-1].append(("C", c1, c2, qp2))
            cur = qp2; last_c2 = c2
    return [(sub[0], sub[1:]) for sub in subs if sub]


def lottie_bezier(start, segs, closed=True):
    """Sous-chemin absolu → géométrie Lottie {v, i, o, c}."""
    v = [list(start)]
    ins = [[0.0, 0.0]]
    outs = [[0.0, 0.0]]
    for kind, *args in segs:
        if kind == "L":
            (x, y) = args[0]
            v.append([x, y]); outs.append([0.0, 0.0]); ins.append([0.0, 0.0])
        else:
            c1, c2, end = args
            v.append(list(end))
            ins.append([c2[0] - end[0], c2[1] - end[1]])
            outs.append([c1[0] - v[-2][0], c1[1] - v[-2][1]])
    # cuit le translate ici, une seule fois, sur les points finaux
    return {"i": ins, "o": outs, "v": v, "c": closed}


def subpaths_from_wordmark():
    """Le wordmark, lu dans `logo/kichub.svg`, translate cuit.

    Retourne une liste de géométries Lottie — un 'sh' chacune.
    """
    svg = Path("logo/kichub.svg").read_text()
    m = re.search(r'transform="translate\(([-\d.]+)(?:\s+([-\d.]+))?\)"', svg)
    dx = float(m.group(1)) if m else 0.0
    dy = float(m.group(2)) if m and m.group(2) else 0.0
    out = []
    for pm in re.finditer(r'<path\b[^>]*?\sd="([^"]+)"[^>]*>', svg):
        tag = pm.group(0)
        if 'fill="none"' in tag:                        # les traits du K
            continue
        if 'style="fill:#e038d1"' in tag:               # le nœud (arc)
            continue
        d = pm.group(1)
        if re.search(r"(?:^|\s)a[-\s.,\d]", d):         # tout autre arc
            continue
        if len(d) < 6:
            continue
        for start, segs in segments_absolute(d):
            if not segs:
                continue
            moved = [start[0] + dx, start[1] + dy]
            baked = tuple(
                (kind,) + tuple((x + dx, y + dy) for x, y in a) for kind, *a in segs)
            out.append(lottie_bezier(moved, baked))
    if not out:
        raise SystemExit("wordmark introuvable dans logo/kichub.svg")
    return out


def shifted_bezier(p, q, dx=0.0, dy=0.0):
    """Trait droit p→q, translate cuit, ouvert (pas de fermeture)."""
    return lottie_bezier([p[0] + dx, p[1] + dy],
                         [("L", (q[0] + dx, q[1] + dy))], closed=False)


def circle_bezier(cx, cy, r):
    """Cercle en quatre cubiques — les contrôles aux quatre points cardinaux."""
    k = 0.5522847498
    t = r * k
    pts = [(cx + r, cy), (cx, cy + r), (cx - r, cy), (cx, cy - r)]
    outs = [(0, t), (-t, 0), (0, -t), (t, 0)]   # tangent sortant par sommet
    v = [[p[0], p[1]] for p in pts]
    outs = [[o[0], o[1]] for o in outs]
    ins = [[-o[0], -o[1]] for o in outs]
    return {"i": ins, "o": outs, "v": v, "c": True}


def shape(bez):
    return {"ty": "sh", "ind": 0, "nm": "", "ks": static(bez)}


def fill(color):
    return {"ty": "fl", "nm": "", "c": static(hex_rgb(color) + [1]),
            "o": static(100), "r": 1}


def stroke(color, w):
    return {"ty": "st", "nm": "", "c": static(hex_rgb(color) + [1]),
            "o": static(100), "w": static(w), "lc": 2, "lj": 2}


def trim(times):
    """e animé, s fixé à 0 : le tracé se dessine de son début."""
    kf = []
    for i, (t, val) in enumerate(times):
        kf.append({"t": t, "s": [val]})
        if i < len(times) - 1:
            kf[-1].update(ease(1, CONT))
    return {"ty": "tm", "nm": "", "s": static(0),
            "e": {"a": 1, "k": kf}, "o": static(0), "m": 1}


def group(items, p=None, op=None, scale=None):
    pv = p if isinstance(p, dict) else (static(p) if p else static([0, 0]))
    sv = scale if isinstance(scale, dict) else static(
        [100, 100] if scale is None else scale)
    tr = {"ty": "tr", "p": pv, "a": static([0, 0]), "s": sv, "r": static(0),
          "o": op if isinstance(op, dict) else static(100 if op is None else op),
          "sk": static(0), "sa": static(0)}
    return {"ty": "gr", "nm": "", "it": list(items) + [tr]}


def layer(ind, name, shapes, ks=None):
    base = {"o": static(100), "r": static(0), "p": static([0, 0, 0]),
            "a": static([0, 0, 0]), "s": static([100, 100, 100])}
    if ks:
        base.update(ks)
    return {"ddd": 0, "ind": ind, "ty": 4, "nm": name, "mn": name,
            "ks": base, "ao": 0, "shapes": shapes, "ip": 0, "op": 999,
            "st": 0, "bm": 0, "hd": False}


def word_group(op=None, p=None, color=None):
    """Le mot posé une fois pour toutes — les variantes animent la couche."""
    color = color or G.ELEC
    return group([shape(b) for b in subpaths_from_wordmark()] + [fill(color)],
                 p=p, op=op)


def k_segments():
    """Les trois traits du K en géométries Lottie (ouverts)."""
    return [shifted_bezier(p, q) for p, q in (G.K_STEM, G.K_UP, G.K_DOWN)]


def node_shape():
    return shape(circle_bezier(G.K_NODE[0], G.K_NODE[1], G.K_NODE[2]))


# ═══ Anim A — LE TRACÉ (one-shot) ════════════════════════════════════════

def build_a():
    nd = G.K_NODE
    segs = k_segments()

    # — couche 3 (fond) : le K — groupes tracés au trait (pas de remplissage,
    # les traits du K sont des lignes ouvertes)
    stem_items = [shape(segs[0]), trim([(0, 0), (16, 100)]), stroke(G.ELEC, G.SW)]
    arms_items = [shape(s) for s in segs[1:]]
    arms_items += [trim([(12, 0), (30, 100)]), stroke(G.ELEC, G.SW)]
    k_l = layer(1, "K", [group(arms_items), group(stem_items)])

    # — couche 2 : le nœud pointe (ressort)
    grow = prop([(28, [0, 0, 100]), (36, [100, 100, 100])], n=3, spec=SPRING)
    node_l = layer(2, "nœud", [group([node_shape(), fill(G.MGNT)])],
                   ks={"a": static([nd[0], nd[1], 0]),
                       "p": static([nd[0], nd[1], 0]), "s": grow})

    # — couche 1 (sommet) : le mot s'élève du dessous
    rise = prop([(44, [0, 22, 0]), (60, [0, 0, 0])], n=3, spec=CONT)
    fade = prop([(44, 0), (60, 100)], n=1, spec=CONT)
    word_l = layer(3, "mot KICHUB", [word_group(op=fade)],
                   ks={"p": rise, "s": static([100, 100, 100])})

    return {"v": "5.7.4", "fr": FPS, "ip": 0, "op": FR_A,
            "w": CW[0], "h": CW[1], "nm": "KICHUB — le tracé",
            "ddd": 0, "assets": [], "layers": [word_l, node_l, k_l]}


# ═══ Anim B — CONNECTÉ (boucle) ══════════════════════════════════════════

def build_b():
    nd = G.K_NODE
    segs = k_segments()

    # le lockup posé, immobile — dernier élément = peint au fond
    base = group([shape(segs[0]), shape(segs[1]), shape(segs[2]),
                  stroke(G.ELEC, G.SW)])
    logo = layer(1, "lockup",
                 [word_group(), group([node_shape(), fill(G.MGNT)]), base])

    # le nœud bat — deux cycles de 45 trames, sans saut de boucle
    beat = prop([(0, [100, 100, 100]), (10, [112, 112, 100]),
                 (22, [100, 100, 100]), (45, [100, 100, 100]),
                 (55, [112, 112, 100]), (67, [100, 100, 100]),
                 (90, [100, 100, 100])], n=3, spec=SPRING)
    node_beat = layer(2, "nœud bat", [group([node_shape(), fill(G.MGNT)])],
                      ks={"a": static([nd[0], nd[1], 0]),
                          "p": static([nd[0], nd[1], 0]), "s": beat})

    # deux ondes de connexion : un anneau qui grandit et s'éteint
    ring_scale = prop([(0, [100, 100, 100]), (15, [190, 190, 100]),
                       (45, [100, 100, 100]), (60, [190, 190, 100]),
                       (90, [100, 100, 100])], n=3, spec=CONT)
    ring_op = prop([(0, 46), (12, 0), (45, 46), (57, 0), (90, 46)], n=1)
    ring_l = layer(
        3, "onde de connexion",
        [group([shape(circle_bezier(nd[0], nd[1], nd[2] + 9)), stroke(G.MGNT, 5)])],
        ks={"a": static([nd[0], nd[1], 0]), "p": static([nd[0], nd[1], 0]),
            "s": ring_scale, "o": ring_op})

    return {"v": "5.7.4", "fr": FPS, "ip": 0, "op": FR_B,
            "w": CW[0], "h": CW[1], "nm": "KICHUB — connecté",
            "ddd": 0, "assets": [], "layers": [ring_l, node_beat, logo]}


# ── Canvas partagé (même gabarit que le SVG maître) ──────────────────────

def canvas():
    vx, vy, vw, vh = BSV.fit_viewbox()
    return (int(round(vw)), int(round(vh)))


def main():
    global CW
    CW = canvas()
    for out, data in ((OUT_A, build_a()), (OUT_B, build_b())):
        out.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        print(f"écrit : {out}  ({out.stat().st_size} octets)")


if __name__ == "__main__":
    main()
