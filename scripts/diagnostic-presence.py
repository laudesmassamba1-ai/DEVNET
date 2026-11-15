"""Diagnostic navigateur de la présence et de la divergence — migration 019.

Exécuter avec :  python3 scripts/diagnostic-presence.py

Un test unitaire prouve que la table et la garde se comportent bien ; il ne
prouve pas qu'un écran les **branche**. Ce qui est vérifié ici n'existe que
si un effet a réellement tourné :

 · le battement a écrit ma session — on le lit dans le stockage local,
   c'est-à-dire par un autre chemin que celui qui l'a écrit ;
 · changer de fichier réécrit la session : trente secondes d'attente pour
   voir un curseur se déplacer seraient un bug, pas une lenteur ;
 · un pair présent sur le même fichier déclenche le bandeau.

Chaque étape agit comme un utilisateur, puis relit ce qui est à l'écran ou
dans le store.
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
KEY = "devnet.demo.v8"

ok = 0
failures: list[str] = []
console_errors: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    if cond:
        ok += 1
    else:
        failures.append(f"{name}{f' → {detail}' if detail else ''}")


def sessions(page) -> list[dict]:
    """Les sessions présentes dans le stockage local du navigateur."""
    raw = page.evaluate(f"() => window.localStorage.getItem({KEY!r})")
    if not raw:
        return []
    return json.loads(raw).get("project_sessions", [])


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        # ── Connexion démo ─────────────────────────────────────────
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_url("**/feed", timeout=15000)
        page.wait_for_timeout(1500)

        # ── 1. Le rail ─────────────────────────────────────────────
        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle")
        page.wait_for_timeout(2200)

        body = page.inner_text("body")
        # Le libellé passe par `label-micro`, qui met en capitales : on
        # compare sans la casse, sinon le test accuse l'interface d'un
        # défaut qui n'est qu'une casse typographique.
        check("le rail de présence est monté", "présence" in body.lower())
        check("le pair du seed est affiché",
              "Thabo" in body, body[:200])
        check("l'absence de pair n'est pas annoncée à tort",
              "personne d'autre sur ce dépôt" not in body)

        # ── 2. Mon battement ───────────────────────────────────────
        # On le lit par le stockage local, pas par l'écran : c'est la
        # seule façon de vérifier que l'effet a bien écrit.
        page.wait_for_timeout(800)
        mine = [s for s in sessions(page) if s.get("user_id") == "u-koffi"]
        check("ma session est écrite", len(mine) == 1, str(mine))

        recorded = str(mine[0].get("file_path", "")) if mine else ""
        check("ma session porte le fichier ouvert", recorded != "", recorded)

        # ── 3. Changer de fichier se dit tout de suite ─────────────
        other = "lecteur.py" if recorded != "lecteur.py" else "registre.py"
        button = page.get_by_role("button", name=other, exact=True)
        check("l'arborescence propose un autre fichier", button.count() > 0, other)

        if button.count() > 0:
            button.first.click()
            page.wait_for_timeout(1500)
            mine = [s for s in sessions(page) if s.get("user_id") == "u-koffi"]
            check("changer de fichier met la session à jour",
                  bool(mine) and mine[0].get("file_path") == other,
                  str(mine[0].get("file_path")) if mine else "aucune")

        # ── 4. Le pair sur le même fichier ─────────────────────────
        # Le seed place Thabo sur `registre.py` ; on s'y met aussi.
        same = page.get_by_role("button", name="registre.py", exact=True)
        if same.count() > 0:
            same.first.click()
            page.wait_for_timeout(1200)

        body = page.inner_text("body")
        check("le bandeau de même-fichier apparaît",
              "a ce même fichier ouvert" in body, body[:300])
        check("le rail signale le même fichier",
              "même fichier" in body)

        # ── Console ────────────────────────────────────────────────
        check("aucune erreur de console",
              len(console_errors) == 0, " | ".join(console_errors[:3]))

        browser.close()


def main() -> None:
    try:
        run()
    except Exception as exc:  # noqa: BLE001
        failures.append(f"exception : {exc}")

    print(f"\n{ok} vérification(s) passée(s), {len(failures)} échec(s)\n")
    if failures:
        for f in failures:
            print(f"  ✗ {f}")
        sys.exit(1)
    print("  ✓ La présence et la divergence s'affichent dans le navigateur\n")


if __name__ == "__main__":
    main()
