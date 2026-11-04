"""Captures de critique visuelle : 3 largeurs × 2 thèmes × N écrans.

Usage : python3 scripts/captures.py <sortie> [chemins...]

Protocole, appris à la première passe ratée :
  1. la clé de thème est `devnet:theme` (lib/theme.ts), pas `devnet-theme` ;
  2. la scène de lancement est marquée vue dans `sessionStorage` avant la
     première navigation, sinon les captures montrent le logo en plein écran ;
  3. en développement, attendre la fin de « Compiling » : une capture prise
     pendant la compilation montre un écran vide.
Chrome système, aucun navigateur téléchargé.
"""
from pathlib import Path
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("DEVNET_BASE", "http://127.0.0.1:3000")
WIDTHS = [375, 768, 1440]
THEMES = ["light", "dark"]
DEFAULT_THEME = "liquid-bleu"
SCREENS = sys.argv[2:] or ["/login"]


def settle(page) -> None:
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)
    page.evaluate("() => [...document.querySelectorAll('*')].length")  # force un paint


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
            page.evaluate("() => sessionStorage.setItem('devnet.splash.seen', '1')")
            for theme in themes:
                value = "light" if theme == "light" else DEFAULT_THEME
                page.evaluate(
                    "v => localStorage.setItem('devnet:theme', v)", value
                )
                for path in cases:
                    page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
                    settle(page)
                    slug = path.strip("/").replace("/", "-") or "accueil"
                    name = f"{width}-{theme}-{slug}.png"
                    page.screenshot(path=str(out / name), full_page=False)
                    print(f"  {name} -> {page.url}")
            context.close()
        browser.close()


if __name__ == "__main__":
    capture(Path(sys.argv[1]), SCREENS, WIDTHS, THEMES)
