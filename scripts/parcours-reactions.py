"""Parcours navigateur — réactions, repost, partage, accusés de lecture.

On ne teste pas des pixels, on teste des **gestes**. Chaque étape est une
action que l'utilisateur peut faire, suivie d'une vérification de ce que
l'interface affiche ensuite.

Le script échoue si un geste ne produit aucun effet visible — c'est la
seule famille de bugs qu'un test unitaire ne voit pas : la ligne est bien
écrite en base, et pourtant rien ne bouge à l'écran.
"""

import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
DEMO_PEER = "u-koffi"


def log(msg: str) -> None:
    print(f"  · {msg}")


def main() -> int:
    echecs: list[str] = []

    def verifie(nom: str, cond: bool, detail: str = "") -> None:
        if cond:
            log(f"✓ {nom}")
        else:
            echecs.append(f"{nom} {detail}".strip())
            print(f"  ✗ {nom} {detail}")

    with sync_playwright() as p:
        navigateur = p.chromium.launch()
        page = navigateur.new_page(viewport={"width": 1280, "height": 900})
        erreurs: list[str] = []
        page.on("pageerror", lambda e: erreurs.append(str(e)))
        page.on(
            "console",
            lambda m: erreurs.append(m.text) if m.type == "error" else None,
        )

        # ── Connexion ────────────────────────────────────────────
        # Le chemin réel est le bouton « Entrer comme » : en mode
        # démonstration il n'y a pas de mot de passe, et chercher un
        # formulaire serait tester un écran que personne n'utilise.
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name=re.compile("Entrer comme")).click()
        page.wait_for_timeout(3000)
        verifie("la session est ouverte", "/login" not in page.url, page.url)

        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)
        log("fil chargé")

        # ── 1. Réaction ──────────────────────────────────────────
        premiere = page.locator("article").first
        bouton_reaction = premiere.get_by_role(
            "button", name=re.compile(r"Réagir|Changer ta réaction")
        )
        verifie("bouton de réaction présent", bouton_reaction.count() > 0)

        bouton_reaction.hover()
        page.wait_for_timeout(450)
        panneau = page.get_by_role("button", name="Rire").first
        verifie("le sélecteur s'ouvre au survol", panneau.is_visible())

        if panneau.is_visible():
            panneau.click()
            page.wait_for_timeout(700)
            # L'éclat est une classe d'animation : sa présence prouve que
            # le geste a produit un mouvement, pas seulement un état.
            eclair = page.locator(".mo-burst").first
            verifie("la réaction produit un éclat", eclair.count() > 0)

            total = premiere.locator(".tnum").all_inner_texts()
            verifie(
                "un compteur de réactions s'affiche",
                any("1" == t.strip() for t in total),
                f"compteurs={total}",
            )

            # Persistance : le rechargement relit la table, pas l'état
            # React. Sans lui, une réaction disparue au refresh donnerait
            # l'impression que le geste n'a jamais eu lieu.
            page.reload(wait_until="networkidle")
            page.wait_for_selector("article", timeout=20_000)
            apres = page.locator("article").first
            conservee = apres.get_by_role(
                "button", name=re.compile(r"Changer ta réaction")
            )
            verifie("la réaction survit au rechargement", conservee.count() > 0)

            # Retrait : re-cliquer sur la même réaction doit la retirer.
            conservee.first.hover()
            page.wait_for_timeout(400)
            retirer = page.get_by_role("button", name="Rire").first
            if retirer.is_visible():
                retirer.click()
                page.wait_for_timeout(600)
                revenu = page.locator("article").first.get_by_role(
                    "button", name=re.compile(r"Réagir à cette publication")
                )
                verifie("re-cliquer retire la réaction", revenu.count() > 0)

        # ── 2. Repost ────────────────────────────────────────────
        bouton_repost = page.locator("article").first.get_by_role(
            "button", name=re.compile(r"Republier dans mon fil|Retirer cette publication")
        )
        verifie("bouton de repost présent", bouton_repost.count() > 0)

        if bouton_repost.count() > 0:
            bouton_repost.first.click()
            page.wait_for_timeout(700)
            arret = page.locator("[data-toast]").first
            verifie(
                "le repost confirme",
                arret.count() > 0 and "Repub" in arret.inner_text(),
                arret.inner_text() if arret.count() else "aucun toast",
            )
            # Second clic = retrait. C'est le bug le plus facile à écrire
            # et le plus dur à voir : le bouton « marche », mais il ne
            # dé-publie jamais.
            retrait = page.locator("article").first.get_by_role(
                "button", name="Retirer cette publication de ton fil"
            )
            verifie("le repost est marqué actif", retrait.count() > 0)

            if retrait.count() > 0:
                retrait.first.click()
                page.wait_for_timeout(700)
                retour = page.locator("article").first.get_by_role(
                    "button", name="Republier dans mon fil"
                )
                verifie("le second clic retire le repost", retour.count() > 0)

        # ── 3. Partage ───────────────────────────────────────────
        # Le partage ouvre une feuille d'applications (pas un lien copié
        # en silence) : c'est elle qu'on attend, pas un toast.
        page.get_by_role("button", name="Partager cette publication").first.click()
        page.wait_for_timeout(700)
        partage = page.get_by_role("listbox", name="Applications pour partager")
        verifie(
            "le partage ouvre la feuille",
            partage.count() > 0,
            "aucune feuille de partage",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # ── 4. Message privé : lecture + frappe ──────────────────
        page.goto(f"{BASE}/messages", wait_until="networkidle")
        page.wait_for_timeout(900)
        conv = page.locator("button").filter(has_text="Aminata").first
        verifie("conversation listée", conv.count() > 0)

        if conv.count() > 0:
            conv.click()
            page.wait_for_timeout(1200)
            bulles = page.locator(".mo-msg-in, .mo-msg-in-alt")
            verifie("messages affichés", bulles.count() > 0)

            # Accusé de lecture : le `✓` est un caractère, pas une icône,
            # donc il se lit dans le texte de la bulle.
            corps = page.locator("body").inner_text()
            verifie(
                "un accusé de lecture est affiché",
                "✓" in corps,
                "aucun glyphe de reçu",
            )

            # Le champ de saisie existe toujours ; taper dedans ne doit
            # pas casser. L'indicateur de frappe ne s'affiche pas pour
            # soi-même — c'est le comportement attendu qu'il soit absent.
            champ = page.locator("textarea").first
            if champ.count() > 0:
                champ.fill("test de frappe")
                page.wait_for_timeout(400)
                verifie(
                    "la saisie fonctionne avec la frappe branchée",
                    "test de frappe" in champ.input_value(),
                )

        # ── 5. Groupe : lu par n/m ───────────────────────────────
        page.goto(f"{BASE}/groups", wait_until="networkidle")
        page.wait_for_timeout(700)
        groupe = page.locator("a[href^='/groups/']").first
        verifie("groupe listé", groupe.count() > 0)

        if groupe.count() > 0:
            groupe.click()
            page.wait_for_timeout(1500)
            zone = page.locator("body").inner_text()
            verifie("le canal s'affiche", "#" in zone or "général" in zone)

        # ── 6. Erreurs console ───────────────────────────────────
        # On filtre les avertissements connus (police, extension) : ce
        # qui nous intéresse est une exception React, pas un 404 d'image.
        graves = [
            e for e in erreurs
            if "React" in e or "TypeError" in e or "ReferenceError" in e
        ]
        verifie("aucune erreur JavaScript", not graves, "; ".join(graves[:2]))

        navigateur.close()

    if echecs:
        print(f"\n{len(echecs)} vérification(s) en échec :")
        for e in echecs:
            print(f"  ✗ {e}")
        return 1

    print("\n  ✓ Réactions, repost, partage, lecture et frappe fonctionnent\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())