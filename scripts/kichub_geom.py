# -*- coding: utf-8 -*-
"""scripts/kichub_geom.py — géométrie du logo KICHUB (source de vérité).

Session du 22 octobre — refonte demandée par le client : « sans
mascotte, sobre, bien fait ». On abandonne le cel shading et la
construction lourde ; le logo devient une **construction monoline** :

    — un **K** tracé au trait uniforme (embouts arrondis), dont le coude
      porte un **nœud magenta** : le point de connexion du réseau ;
    — un **wordmark KICHUB** posé en Inter (police installée), rendu en
      chemins par inkscape — pas de lettres dessinées à la main.

Palette conservée du fichier source :

    indigo électrique  #2505B7   le K et le mot
    magenta            #E038D1   le nœud (l'accent unique)
    blanc              #FFFFFF   variante sur fond sombre

Le module ne décrit que des *props* (dictionnaires simples) ; les
générateurs (`build_kichub_svg.py`, `build_lottie.py`) les consomment
et ne redessinent rien.
"""

# ── Palette ──────────────────────────────────────────────────────────────
ELEC = "#2505B7"    # indigo électrique — le K et le mot
MGNT = "#E038D1"    # magenta — le nœud de connexion
INK  = "#FFFFFF"    # blanc — variante inversée

W, H = 560, 480     # gabarit du lockup (K au-dessus, mot en dessous)

# ── Le monogramme ───────────────────────────────────────────────────────
# Trait uniforme, embouts ronds. Le K vit dans un carré de 240, centré.
SW = 30             # épaisseur du trait
K_STEM = [(150, 84), (150, 316)]            # hampe verticale
K_UP   = [(222, 196), (396, 84)]            # jambe montante (coude → haut droit)
K_DOWN = [(222, 196), (396, 316)]           # jambe descendante (coude → bas droit)
K_NODE = (222, 196, 17)                     # le nœud : (x, y, rayon) — accent


# ── Le wordmark ─────────────────────────────────────────────────────────
def wordmark():
    """Spec du texte : posé en Inter, vectorisé ensuite par inkscape."""
    return {
        "text": "KICHUB",
        "font": "Inter Display SemiBold",
        "size": 64,
        "tracking": 6.4,        # ≈ 0,10 em — respiration du réseau
        "fill": ELEC,
        # baseline y ; le centrage horizontal est fait au build (bbox).
        "y": 424,
    }


# ── Assemblage du lockup ────────────────────────────────────────────────
def lockup(accent=MGNT, letter=ELEC):
    """Renvoie la liste des props du lockup, dans l'ordre de peinture."""
    return [
        {"kind": "stroke", "pts": [K_STEM], "w": SW, "cap": "round", "stroke": letter},
        {"kind": "stroke", "pts": [K_UP, K_DOWN], "w": SW, "cap": "round",
         "join": "round", "stroke": letter},
        {"kind": "circle", "c": K_NODE, "fill": accent},
        {"kind": "text", **wordmark(), "fill": letter},
    ]


def strokes_for_animation():
    """Chemins du K, destés au générateur Lottie (ordre du récit)."""
    return {
        "stem": [K_STEM],
        "arms": [K_UP, K_DOWN],
        "node": K_NODE,
    }
