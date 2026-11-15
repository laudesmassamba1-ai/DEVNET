"""Diagnostic large — toutes les routes, après hydratation.

On visite chaque écran **connecté** (le cas le plus courant : un
utilisateur sans session ne voit qu'une redirection, il ne peut pas juger
l'interface), on note les erreurs de console et on mesure ce qui est
réellement rendu.

Trois mesures par page, parce qu'ellesAttrapent trois familles de pannes
différentes :

* `erreurs` — un
  message : c'est le seul moyen de le savoir depuis l'extérieur.
* `longueur` — quelques centaines de caractères prouvent qu'on a rendu du
  contenu, pas une coque HTML.
* `boutons` — une page dont tous les boutons ont un nom vide est
  inexploitable au clavier et muette pour un lecteur d'écran.

Exécuter avec :  python3 scripts/diagnostic-pages.py
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

ROUTES = [
    ("/", "accueil"),
    ("/feed", "fil"),
    ("/search", "recherche"),
    ("/notifications", "notifications"),
    ("/messages", "messages"),
    ("/groups", "groupes"),
    ("/groups/g-1", "groupe"),
    ("/projects", "projets"),
    ("/profile", "profil"),
    ("/moderation", "moderation"),
    ("/u/koffi", "profil public"),
    ("/u/koffi/followers", "abonnes"),
    ("/post/p-1", "publication"),
    ("/preview-code", "apercu code"),
    ("/setup", "configuration"),
]


def main() -> int:
    problemes = 0

    with sync_playwright() as p:
        nav = p.chromium.launch()
        page = nav.new_page(viewport={"width": 1280, "height": 900})
        erreurs: list[str] = []
        page.on("pageerror", lambda e: erreurs.append(f"EXC {e}"))
        page.on(
            "console",
            lambda m: erreurs.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        # Session ouverte : c'est l'état dans lequel on juge une interface.
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(2500)

        for route, nom in ROUTES:
            erreurs.clear()
            page.goto(f"{BASE}{route}", wait_until="networkidle")
            page.wait_for_timeout(2200)

            corps = page.inner_text("body")
            boutons = page.locator("button")
            total = boutons.count()
            sans_nom = page.evaluate(
                """() => [...document.querySelectorAll('button')]
                     .filter(b => !(b.innerText || '').trim()
                             && !b.getAttribute('aria-label')
                             && !b.getAttribute('title')).length"""
            )

            drapeaux = []
            if erreurs:
                drapeaux.append(f"{len(erreurs)} erreur(s) console")
            if len(corps.strip()) < 200:
                drapeaux.append(f"page quasi vide ({len(corps.strip())} car.)")
            if sans_nom:
                drapeaux.append(f"{sans_nom} bouton(s) sans nom accessible")
            if "undefined" in corps or "NaN" in corps:
                drapeaux.append("« undefined » ou « NaN » affichés")

            if drapeaux:
                problemes += 1
                print(f"✗ {route:24} {nom:16} {' ; '.join(drapeaux)}")
                for e in erreurs[:3]:
                    print(f"      {e[:180]}")
            else:
                print(f"✓ {route:24} {nom:16} {len(corps.strip()):5} car., {total} boutons")

        nav.close()

    print()
    if problemes:
        print(f"{problemes} route(s) en défaut")
        return 1
    print("Toutes les routes rendent et ne lèvent rien")
    return 0


if __name__ == "__main__":
    sys.exit(main())