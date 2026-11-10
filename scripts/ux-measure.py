"""Mesures de rendu de l'interface — ce que le scanner statique ne voit pas.

À lancer sur le serveur de démonstration :

    NEXT_PUBLIC_FORCE_DEMO=true npm run dev
    npm run ux:measure

Écrit `docs/ui/measurements.json` et des captures dans `docs/ui/audit/`.
Aucune dépendance au-delà de Playwright (déjà utilisé par les parcours).

Ce qui est mesuré, route par route, à 360×640 et 1440×900 :
- débordement horizontal de la page ;
- polices calculées sous 12 px, et champs sous 16 px ;
- cibles tactiles sous 44×44 px (exception WCAG « en ligne » exclue) ;
- contrôles sans nom accessible (icône seule) ;
- anneau de focus visible ou non sur les 12 premiers arrêts de tabulation ;
- animations en mouvement réduit (`document.getAnimations()`).

`/login` est mesuré **déconnecté**, dans un contexte vierge : connecté, la page
redirige vers le fil et l'on mesurerait deux fois le même écran.
"""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = Path("docs/ui")
AUDIT = OUT / "audit"

ROUTES = [
    "/feed",
    "/profile",
    "/projects",
    "/projects/p-1",
    "/u/aminata_dev",
    "/messages",
    "/settings",
    "/extensions",
]

ANON_ROUTES = ["/login"]

VIEWPORTS = [("mobile", 360, 640), ("desktop", 1440, 900)]

MEASURE_JS = """
() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
  };

  // 1. Débordement horizontal.
  const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;

  // 2. Textes sous 12 px.
  const tiny = [];
  const seenText = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (!own) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    const key = el.tagName + '|' + own.slice(0, 30) + '|' + size;
    if (seenText.has(key)) continue;
    seenText.add(key);
    if (size < 12 - 0.01) tiny.push({ size: Math.round(size * 10) / 10, text: own.slice(0, 40), tag: el.tagName.toLowerCase() });
  }

  // 3. Cibles tactiles.
  //    Exception WCAG 2.5.8 « en ligne » : un lien au fil d'une phrase est
  //    borné par l'interligne du texte, on ne le compte pas comme une cible.
  const inlineException = (el) => {
    // `data-inline-link` : lien posé **dans une phrase** (hashtag, mention),
    // que le lecteur traverse au fil du texte. Lui imposer 44 × 44 px
    // ouvrirait des trous dans le paragraphe ; la norme l'exempte.
    if (el.hasAttribute('data-inline-link')) return true;
    const s = getComputedStyle(el);
    if (s.display !== 'inline') return false;
    return !!el.closest('p, li, figcaption, blockquote');
  };
  const interactive = document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch], [role=link], [tabindex]:not([tabindex="-1"])'
  );
  const small = [];
  let interactiveTotal = 0;
  for (const el of interactive) {
    if (!visible(el) || inlineException(el)) continue;
    interactiveTotal += 1;
    const r = el.getBoundingClientRect();
    if (r.width < 44 - 0.01 || r.height < 44 - 0.01) {
      small.push({
        tag: el.tagName.toLowerCase(),
        w: Math.round(r.width),
        h: Math.round(r.height),
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30),
      });
    }
  }

  // 4. Contrôles sans nom accessible (heuristique DOM, pas le calcul ARIA complet).
  const unnamed = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button]')) {
    if (!visible(el) || inlineException(el)) continue;
    const text = (el.textContent || '').trim();
    const aria = (el.getAttribute('aria-label') || '').trim();
    const labelled = (el.getAttribute('aria-labelledby') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const imgAlt = Array.from(el.querySelectorAll('img')).some((i) => (i.getAttribute('alt') || '').trim());
    if (!text && !aria && !labelled && !title && !imgAlt) {
      unnamed.push({ tag: el.tagName.toLowerCase(), html: el.outerHTML.slice(0, 120) });
    }
  }

  // 5. Champs : hauteur, police, et nom accessible **réel**.
  // `el.labels` couvre le `<label for>` comme le `<label>` enveloppant :
  // c'est la seule mesure qui ne peut pas être trompée par du JSX.
  const fields = [];
  const fieldsWithoutName = [];
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')) {
    if (!visible(el)) continue;
    // Monaco pose une zone de saisie interne (composition IME) sans nom :
    // ce n'est pas un champ de l'application, et elle est cachée.
    if (el.closest('.monaco-editor, [aria-hidden="true"]')) continue;
    const s = getComputedStyle(el);
    const labelledBy = el.getAttribute('aria-labelledby');
    const named =
      (el.labels && el.labels.length > 0) ||
      !!el.getAttribute('aria-label') ||
      !!(labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) ||
      !!el.getAttribute('title');
    if (!named) {
      fieldsWithoutName.push({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        placeholder: (el.getAttribute('placeholder') || '').slice(0, 40),
        name: (el.getAttribute('name') || '').slice(0, 30),
      });
    }
    fields.push({
      tag: el.tagName.toLowerCase(),
      fontSize: Math.round(parseFloat(s.fontSize) * 10) / 10,
      h: Math.round(el.getBoundingClientRect().height),
    });
  }

  // 6. Mouvement au repos : éléments qui déclarent une transition.
  const transitions = Array.from(document.querySelectorAll('body *')).filter((el) => {
    const s = getComputedStyle(el);
    return parseFloat(s.transitionDuration) > 0;
  }).length;

  return { overflow, tiny, small, interactiveTotal, unnamed, fields, fieldsWithoutName, transitions };
}
"""


def close_overlay(page):
    try:
        if page.evaluate("() => !!document.querySelector('.overlay-veil')"):
            page.keyboard.press("Escape")
            page.wait_for_timeout(900)
    except Exception:  # noqa: BLE001
        pass


def focus_ring(page, stops=12):
    """Tape `stops` fois et regarde si chaque arrêt montre un anneau visible."""
    page.evaluate("() => { document.body.focus(); }")
    page.keyboard.press("Tab")
    page.wait_for_timeout(120)
    invisible = []
    for _ in range(stops):
        info = page.evaluate(
            """
            () => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const s = getComputedStyle(el);
              // Un anneau est visible si le contour est tracé, assez épais, et
              // **opaque** : `outline: 2px solid transparent` est le contour que
              // Tailwind pose pour `outline-none` — il existe et ne se voit pas.
              const opaque = !/transparent|rgba\(0, 0, 0, 0\)/.test(s.outlineColor);
              const ring =
                s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1 && opaque;
              return {
                tag: el.tagName.toLowerCase(),
                label: (el.getAttribute('aria-label') || el.textContent || el.value || '').trim().slice(0, 30),
                ring,
                outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor,
                shadow: (s.boxShadow || 'none').slice(0, 60),
              };
            }
            """
        )
        if info and not info["ring"]:
            invisible.append(info)
        page.keyboard.press("Tab")
        page.wait_for_timeout(80)
    return invisible


def animations(page):
    return page.evaluate(
        """
        () => {
          const running = document.getAnimations().filter((a) => a.playState === 'running');
          return {
            running: running.length,
            infinite: running.filter((a) => {
              const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
              return t && t.iterations === Infinity;
            }).length,
            sample: running.slice(0, 4).map((a) => (a.animationName || a.constructor.name)),
          };
        }
        """
    )


def measure_route(page, route, result, failures):
    """Mesure une route sur les deux fenêtres et range le résultat."""
    key = (route.strip("/") or "accueil").replace("/", "-")
    result["routes"][route] = {}

    for name, width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        page.goto(f"{BASE}{route}", wait_until="domcontentloaded")
        page.wait_for_timeout(3500 if width < 768 else 2500)
        close_overlay(page)

        data = page.evaluate(MEASURE_JS)
        focus = focus_ring(page)
        anim = animations(page)

        # Mouvement réduit.
        page.emulate_media(reduced_motion="reduce")
        page.wait_for_timeout(500)
        reduced = animations(page)
        page.emulate_media(reduced_motion="no-preference")

        shot = AUDIT / f"{key}-{width}.png"
        page.screenshot(path=str(shot), full_page=False)

        result["routes"][route][name] = {
            "overflow": data["overflow"],
            "tinyText": len(data["tiny"]),
            "tinyTextSamples": data["tiny"][:5],
            "interactiveTotal": data["interactiveTotal"],
            "smallTargets": len(data["small"]),
            "smallTargetsSamples": data["small"][:5],
            "unnamedControls": len(data["unnamed"]),
                    "fieldsWithoutName": len(data["fieldsWithoutName"]),
                    "fieldsWithoutNameSamples": data["fieldsWithoutName"][:6],
            "unnamedSamples": data["unnamed"][:5],
            "fieldsUnder16": [f for f in data["fields"] if f["fontSize"] < 16],
            "focusInvisible": len(focus),
            "focusInvisibleSamples": focus[:3],                    "transitions": data["transitions"],
                    "animations": anim,
                    "animationsReduced": reduced,
            "screenshot": str(shot),
        }
        print(
            f"{route:22} {name:8} overflow={data['overflow']!s:5} "
            f"tiny={len(data['tiny']):3} small={len(data['small']):3}/{data['interactiveTotal']:<3} "
            f"unnamed={len(data['unnamed']):2} focus↓={len(focus):2} "
            f"trans={data['transitions']:3} anim={anim['running']:2} reduced={reduced['running']:2} "
            f"champs-sans-nom={len(data['fieldsWithoutName']):3}"
        )


def main():
    AUDIT.mkdir(parents=True, exist_ok=True)
    result = {"base": BASE, "routes": {}}
    failures = []

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. Les routes anonymes, dans un contexte vierge.
        anon_context = browser.new_context()
        anon_page = anon_context.new_page()
        anon_page.on("console", lambda m: failures.append(m.text) if m.type == "error" else None)
        for route in ANON_ROUTES:
            measure_route(anon_page, route, result, failures)
        anon_context.close()

        # 2. Session de démonstration, puis les routes connectées.
        context = browser.new_context()
        page = context.new_page()
        page.on("console", lambda m: failures.append(m.text) if m.type == "error" else None)
        page.goto(f"{BASE}/login", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        try:
            page.get_by_role("button", name=re.compile("Entrer comme")).first.click(timeout=10000)
            page.wait_for_timeout(3000)
        except Exception as exc:  # noqa: BLE001
            print("  ! entrée en démonstration impossible:", str(exc).splitlines()[0])

        for route in ROUTES:
            measure_route(page, route, result, failures)

        browser.close()

    (OUT / "measurements.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(f"\nmesures écrites : {OUT / 'measurements.json'}")
    print(f"captures : {AUDIT}/")
    if failures:
        print(f"\n{len(failures)} erreur(s) console : {failures[:3]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
