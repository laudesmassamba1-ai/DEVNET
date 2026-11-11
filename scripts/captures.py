"""Captures de critique visuelle : 3 largeurs × 2 thèmes × N écrans.

Usage : python3 scripts/captures.py <sortie> [chemins...]

Protocole, appris aux passes ratées :
  1. la clé de thème est `devnet:theme` (lib/theme.ts) ;
  2. la scène de lancement est marquée vue dans `sessionStorage` avant la
     première navigation, sinon les captures montrent le logo en plein écran ;
  3. en développement, la première visite compile la route : attendre un
     `networkidle` puis un corps de page non vide, jamais une durée fixe ;
  4. le thème du **profil** est réappliqué après le montage (`ThemeApplier`),
     donc il écrase `localStorage`. On pose `data-theme` juste avant la
     capture : la planche montre le jeu de tokens demandé, pas le dernier
     choix enregistré dans la démo ;
  5. `DEVNET_LOGIN=1` ouvre une session par un compte de démonstration, pour
     capturer les écrans qui exigent un membre ; la visite guidée est marquée
     vue, sinon elle recouvre la moitié de la planche.

Chrome système, aucun navigateur téléchargé.
"""
from pathlib import Path
import os
import sys

from playwright.sync_api import sync_playwright

# `localhost`, jamais `127.0.0.1` : Next bloque les ressources de développement
# (`/_next/hmr`) venues d'une autre origine, et la page ne s'hydrate plus —
# on capture alors un logo sur fond vide en croyant photographier le produit.
BASE = os.environ.get("DEVNET_BASE", "http://localhost:3000")
LOGIN = os.environ.get("DEVNET_LOGIN") == "1"
WIDTHS = [375, 768, 1440]
THEMES = ["light", "dark"]
SCREENS = sys.argv[2:] or ["/login"]


def settle(page) -> None:
    """Attend que la page ait vraiment du contenu.

    Une durée fixe est un pari : en développement, Turbopack compile la
    route à la première visite et la page reste sur son écran de chargement
    plus longtemps que n'importe quel `wait_for_timeout` raisonnable.
    """
    page.wait_for_load_state("networkidle")
    try:
        page.wait_for_function(
            "() => document.body.innerText.trim().length > 300", timeout=25_000
        )
    except Exception:
        # On ne masque pas l'échec : la capture sera prise et la personne
        # verra bien un écran vide, ce qui est l'information utile.
        print("  ! contenu toujours vide après 25 s")
    page.wait_for_timeout(700)


def open_session(page) -> None:
    """Ouvre la session de démonstration, une fois par contexte."""
    page.goto(f"{BASE}/login", wait_until="domcontentloaded")
    settle(page)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(2500)


def capture(out: Path, cases: list[str], widths: list[int], themes: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=True)
        for width in widths:
            context = browser.new_context(
                viewport={"width": width, "height": 900 if width > 500 else 812},
                device_scale_factor=1,
            )
            page = context.new_page()
            page.goto(BASE, wait_until="domcontentloaded")
            page.evaluate(
                "() => { sessionStorage.setItem('devnet.splash.seen', '1');"
                " localStorage.setItem('devnet.tour.v1', 'done'); }"
            )
            if LOGIN:
                open_session(page)
            for theme in themes:
                for path in cases:
                    page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
                    settle(page)
                    # Le profil de démonstration réapplique son thème : on
                    # repose l'attribut pour la planche, sans toucher à la base.
                    page.evaluate(
                        "t => { document.documentElement.dataset.theme = t;"
                        " localStorage.setItem('devnet:theme', t); }",
                        theme,
                    )
                    page.wait_for_timeout(250)
                    slug = path.strip("/").replace("/", "-") or "accueil"
                    name = f"{width}-{theme}-{slug}.png"
                    page.screenshot(path=str(out / name), full_page=False)
                    print(f"  {name} -> {page.url}")
            context.close()
        browser.close()


if __name__ == "__main__":
    capture(Path(sys.argv[1]), SCREENS, WIDTHS, THEMES)
