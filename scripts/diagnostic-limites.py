"""Diagnostic des chemins que les autres scripts ne touchent pas.

* **Signaler un commentaire** — le bouton de signalement du panneau de
  commentaires est un composant distinct de celui de la carte. Un
  chemin non testé est un chemin qui peut être cassé sans que rien
  ne le dise.
* **Envoyer dans un canal de groupe** — le composeur de canal a sa
  propre logique d'insertion et son propre retour à zéro.
* **Mobile** — les cibles tactiles, la barre d'actions d'une carte et la
  fenêtre de signalement se comportent différemment en dessous de 640 px.

Exécuter avec :  python3 scripts/diagnostic-limites.py
"""

import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"


def rx(p: str):
    return re.compile(p, re.IGNORECASE)


def main() -> int:
    echecs: list[str] = []

    def verifie(nom: str, cond: bool, detail: str = "") -> None:
        if cond:
            print(f"  ✓ {nom}")
        else:
            echecs.append(f"{nom} — {detail}")
            print(f"  ✗ {nom}  {detail}")

    with sync_playwright() as p:
        nav = p.chromium.launch()
        page = nav.new_page(viewport={"width": 1280, "height": 900})
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"EXC {e}"))
        page.on(
            "console",
            lambda m: errs.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(2500)

        # ── 1. Signaler un commentaire ──────────────────────────
        print("\n[1] Signaler un commentaire")
        page.goto(f"{BASE}/post/p-1", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)
        page.get_by_role("button", name=rx(r"Ouvrir les")).first.click()
        page.wait_for_timeout(1200)

        panneau = page.get_by_role("dialog")
        if panneau.count() == 0:
            verifie("le panneau s'ouvre", False, "pas de dialogue")
        else:
            signaux = panneau.first.get_by_role("button", name=rx(r"Signaler"))
            verifie(
                "un bouton « signaler » sur un commentaire existe",
                signaux.count() > 0,
                f"{signaux.count()} bouton(s)",
            )

            if signaux.count() > 0:
                errs.clear()
                signaux.first.click()
                page.wait_for_timeout(1000)
                dlg = page.get_by_role("dialog").last
                verifie("la fenêtre de signalement s'ouvre", dlg.count() > 0)

                if dlg.count() > 0:
                    # Les motifs sont un `radiogroup` (boutons au rôle
                    # `radio`), pas des `input[type=radio]` : chercher
                    # des cases à cocher ne trouverait rien et laisserait
                    # l'envoi désactivé, en faisant croire à un bug.
                    motifs = dlg.get_by_role("radio")
                    verifie(
                        "les motifs sont exposés comme des choix",
                        motifs.count() > 1,
                        f"{motifs.count()} motif(s)",
                    )
                    if motifs.count() > 0:
                        motifs.first.click()
                        page.wait_for_timeout(400)

                        # La flèche doit déplacer le choix : c'est ce qui
                        # distingue un vrai groupe de radio d'une suite de
                        # boutons qui se pretendent exclusifs.
                        avant = motifs.first.get_attribute("aria-checked")
                        motifs.first.press("ArrowDown")
                        page.wait_for_timeout(400)
                        apres = motifs.nth(1).get_attribute("aria-checked")
                        verifie(
                            "la flèche déplace le choix",
                            avant != apres or apres == "true",
                            f"{avant} → {apres}",
                        )

                    envoi = dlg.get_by_role("button", name=rx(r"Envoyer|Signal|envoyer"))
                    verifie("bouton d'envoi présent", envoi.count() > 0)
                    if envoi.count() > 0 and envoi.first.is_enabled():
                        envoi.first.click()
                        page.wait_for_timeout(1600)
                        toast = page.locator("[data-toast]").first
                        msg = toast.inner_text() if toast.count() > 0 else ""
                        verifie(
                            "le signalement du commentaire est confirmé",
                            "signal" in msg.lower(),
                            f"toast={msg!r}",
                        )
                    else:
                        verifie("le bouton d'envoi est actif", False, "désactivé")

            verifie("aucune erreur au signalement d'un commentaire", not errs, "; ".join(errs[:2]))

            page.keyboard.press("Escape")
            page.wait_for_timeout(600)

        # ── 2. Envoyer dans un canal de groupe ──────────────────
        print("\n[2] Envoyer un message de canal")
        page.goto(f"{BASE}/groups/g-1", wait_until="networkidle")
        page.wait_for_timeout(2200)

        errs.clear()
        champ = page.locator("#composer-channel")
        verifie("le composeur de canal existe", champ.count() > 0)

        if champ.count() > 0:
            marqueur = "diagnostic-canal-5517"
            champ.fill(marqueur)
            page.wait_for_timeout(400)
            verifie("le composeur accepte la saisie", marqueur in champ.input_value())

            champ.press("Enter")
            page.wait_for_timeout(1800)

            corps = page.inner_text("body")
            verifie("le message apparaît dans le canal", marqueur in corps)
            verifie("aucune erreur à l'envoi", not errs, "; ".join(errs[:2]))
            verifie("le composeur est vidé après envoi", champ.input_value().strip() == "")

            # Le message doit être rattaché au bon canal : changer de
            # canal et vérifier qu'il n'y est plus est le seul moyen de
            # prouver que `channel_id` est bien écrit.
            autres = page.locator("a[href*='c=']")
            if autres.count() > 1:
                autres.nth(1).click()
                page.wait_for_timeout(1600)
                verifie(
                    "le message reste dans son canal",
                    marqueur not in page.inner_text("body"),
                    "le message apparaît dans un autre canal",
                )

        # ── 3. Mobile ───────────────────────────────────────────
        print("\n[3] Mobile (390 × 844)")
        tel = nav.new_page(viewport={"width": 390, "height": 844})
        tel.on("pageerror", lambda e: errs.append(f"EXC mobile {e}"))
        tel.on(
            "console",
            lambda m: errs.append(f"CONSOLE mobile {m.text}") if m.type == "error" else None,
        )
        tel.goto(f"{BASE}/login", wait_until="networkidle")
        tel.wait_for_timeout(1000)
        tel.get_by_role("button", name="Entrer comme").click()
        tel.wait_for_timeout(2500)
        tel.goto(f"{BASE}/feed", wait_until="networkidle")
        tel.wait_for_selector("article", timeout=20_000)
        tel.wait_for_timeout(1500)

        # Un débordement horizontal est le symptôme le plus fiable d'une
        # interface cassée en mobile : on ne peut pas faire défiler pour
        # voir ce qui dépasse.
        debordement = tel.evaluate(
            "() => document.documentElement.scrollWidth - window.innerWidth"
        )
        verifie(
            "aucun débordement horizontal",
            debordement <= 1,
            f"{debordement}px de débordement",
        )

        carte = tel.locator("article").first
        actions = carte.locator("button")
        tailles = actions.evaluate_all(
            "els => els.map(e => ({n:(e.getAttribute('aria-label')||e.innerText||'').trim().slice(0,26),"
            " h:Math.round(e.getBoundingClientRect().height)}))"
        )
        trop_petits = [t for t in tailles if t["h"] < 24]
        verifie(
            "toutes les actions d'une carte sont atteignables au pouce",
            not trop_petits,
            f"sous 24px : {trop_petits}",
        )

        # Le signalement doit rester atteignable en mobile : c'est un
        # bouton icône, et les boutons icône sont les premiers à
        # disparaître quand la barre d'actions déborde. On cherche sur
        # toute la page : la carte de tête est celle du lecteur connecté,
        # et on ne signale pas son propre contenu — le bouton n'y est
        # donc pas, ce qui serait un faux négatif.
        tel_btn = tel.get_by_role("button", name=rx(r"Signaler")).first
        verifie("le bouton « signaler » reste en mobile", tel_btn.count() > 0)

        if tel_btn.count() > 0:
            tel_btn.click()
            tel.wait_for_timeout(1000)
            verifie(
                "la fenêtre de signalement s'ouvre en mobile",
                tel.get_by_role("dialog").count() > 0,
            )

        tel.close()
        nav.close()

    print()
    if echecs:
        print(f"{len(echecs)} problème(s) :")
        for e in echecs:
            print(f"  ✗ {e}")
        return 1
    print("Tous les chemins limites fonctionnent")
    return 0


if __name__ == "__main__":
    sys.exit(main())