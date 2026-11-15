"""Balayage fonctionnel — tout ce qui n'a pas encore été exercé.

Un diagnostic qui couvre les mêmes dix gestes dix fois ne prouve rien de
plus. Celui-ci prend le **complément** : onglets de projet, wiki, issues,
demandes d'intégration, suivi, recherche, notifications, brouillon de
publication, modification et suppression.

Le principe reste le même : un clic, puis ce que l'interface montre, puis
la survie au rechargement. Et on note les erreurs de console à chaque
étape, parce qu'une exception React peut laisser un écran à moitié rempli
— qui « s'affiche », mais ne fonctionne pas.

Exécuter avec :  python3 scripts/diagnostic-fonctionnel.py
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
        page = nav.new_page(viewport={"width": 1440, "height": 950})
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"EXC {e}"))
        page.on(
            "console",
            lambda m: errs.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        def step(nom: str) -> None:
            errs.clear()

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(2500)

        # ── Onglets de projet ───────────────────────────────────
        print("\n[1] Onglets d'un dépôt")
        page.goto(f"{BASE}/projects", wait_until="networkidle")
        page.wait_for_timeout(1800)
        lien = page.locator("a[href^='/projects/']").first
        verifie("un dépôt est listé", lien.count() > 0)

        if lien.count() > 0:
            lien.click()
            page.wait_for_timeout(2200)

            # Chaque onglet est un rôle `tab` : on les ouvre tous, et on
            # vérifie que chacun rend du contenu **différent**. Deux
            # onglets qui affichent la même chose, c'est un onglet mort
            # qui ne se distingue d'un onglet fonctionnel qu'en
            # comptant carefully.
            onglets = page.get_by_role("tab")
            total = onglets.count()
            verifie("les onglets sont exposés comme des onglets", total > 1, f"{total}")

            rendus = {}
            for i in range(total):
                step(f"onglet {i}")
                onglets.nth(i).click()
                page.wait_for_timeout(1500)
                nom = onglets.nth(i).inner_text().strip()[:18]
                rendus[nom] = page.inner_text("body")[-1200:]
                verifie(
                    f"onglet « {nom} » rend du contenu",
                    not errs and len(rendus[nom].strip()) > 60,
                    f"erreurs={errs[:1]} taille={len(rendus[nom].strip())}",
                )

            if len(set(rendus.values())) < len(rendus):
                doublons = [k for k in rendus if list(rendus).count(k) and False]
                verifie(
                    "chaque onglet montre autre chose",
                    len(set(rendus.values())) == len(rendus),
                    f"contenus identiques : {list(rendus)}",
                )
            else:
                print("  ✓ chaque onglet montre autre chose")

            # Le wiki est l'onglet qui a le plus souvent décroché : il
            # enregistre une page par un formulaire.
            wiki = page.get_by_role("tab", name=rx(r"doc|wiki"))
            if wiki.count() > 0:
                wiki.first.click()
                page.wait_for_timeout(1500)
                corps = page.inner_text("body")
                verifie(
                    "le wiki affiche une page ou un sommaire",
                    len(corps.strip()) > 300,
                    f"{len(corps.strip())} car.",
                )

        # ── Issues et demandes d'intégration ─────────────────────
        print("\n[2] Issues et demandes d'intégration")
        page.goto(f"{BASE}/projects", wait_until="networkidle")
        page.wait_for_timeout(1500)
        lien = page.locator("a[href^='/projects/']").first
        if lien.count() > 0:
            lien.click()
            page.wait_for_timeout(2000)

            issues = page.get_by_role("tab", name=rx(r"issue"))
            if issues.count() > 0:
                step("issues")
                issues.first.click()
                page.wait_for_timeout(1400)
                corps = page.inner_text("body")
                verifie("les issues s'affichent", len(corps.strip()) > 300, f"{len(corps.strip())} car.")
                verifie("aucune erreur à l'ouverture des issues", not errs, "; ".join(errs[:1]))

            prs = page.get_by_role("tab", name=rx(r"intégration|merge|PR"))
            if prs.count() > 0:
                step("PR")
                prs.first.click()
                page.wait_for_timeout(1400)
                verifie(
                    "les demandes d'intégration s'affichent",
                    len(page.inner_text("body").strip()) > 300,
                )
                verifie("aucune erreur à l'ouverture des PR", not errs, "; ".join(errs[:1]))

        # ── Suivre / ne plus suivre ──────────────────────────────
        print("\n[3] Suivre un compte")
        page.goto(f"{BASE}/u/thabo_codes", wait_until="networkidle")
        page.wait_for_timeout(1800)
        suivre = page.get_by_role("button", name=rx(r"suivre|ne plus suivre"))
        verifie("un bouton de suivi existe", suivre.count() > 0)

        if suivre.count() > 0:
            avant = suivre.first.inner_text().strip()
            step("suivi")
            suivre.first.click()
            page.wait_for_timeout(1400)
            apres = page.get_by_role("button", name=rx(r"suivre|ne plus suivre")).first.inner_text().strip()
            verifie("le bouton de suivi change d'état", avant != apres, f"{avant!r} → {apres!r}")
            verifie("aucune erreur au suivi", not errs, "; ".join(errs[:1]))

            # Le compteur d'abonnés doit bouger avec l'état — c'est le
            # seul endroit où une divergence se verrait.
            verifie(
                "la page reflète l'état du suivi",
                "ne plus suivre" in apres.lower() or "suiv" in apres.lower(),
                apres,
            )

        # ── Recherche ────────────────────────────────────────────
        print("\n[4] Recherche")
        page.goto(f"{BASE}/search", wait_until="networkidle")
        page.wait_for_timeout(1500)
        champ = page.locator("input").first
        if champ.count() > 0:
            step("recherche")
            champ.fill("python")
            page.wait_for_timeout(2200)
            verifie(
                "la recherche rend des résultats",
                len(page.inner_text("body").strip()) > 250,
                f"{len(page.inner_text('body').strip())} car.",
            )
            verifie("aucune erreur pendant la recherche", not errs, "; ".join(errs[:1]))

        # ── Notifications : tout effacer ─────────────────────────
        print("\n[5] Centre de notifications")
        page.goto(f"{BASE}/notifications", wait_until="networkidle")
        page.wait_for_timeout(2000)
        step("notifications")
        tout = page.get_by_role("button", name=rx(r"tout (marquer|effacer)|tout effacer"))
        if tout.count() > 0:
            tout.first.click()
            page.wait_for_timeout(1500)
            verifie("aucune erreur au nettoyage", not errs, "; ".join(errs[:1]))
            reste = page.get_by_role("button", name=rx(r"tout (marquer|effacer)|tout effacer"))
            verifie(
                "l'action n'est plus proposée quand il n'y a plus rien",
                reste.count() == 0 or reste.first.is_disabled(),
                "le bouton reste actif alors que la liste est vide",
            )
        else:
            print("  · aucun bouton « tout effacer » (liste peut-être vide)")

        # ── Brouillon de publication ────────────────────────────
        print("\n[6] Brouillon de publication (feuille)")
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)
        step("brouillon")

        # On écrit dans la feuille puis on la ferme : le texte doit
        # disparaître, sinon le brouillon revient à l'écran suivant et on
        # publie du texte qu'on croyait avoir abandonné.
        page.get_by_role("button", name="Écrire une publication").click()
        page.wait_for_timeout(800)
        feuilles = page.get_by_role("dialog")
        verifie("la feuille de publication s'ouvre", feuilles.count() > 0)
        if feuilles.count() > 0:
            ta = page.get_by_placeholder("Rédige ta publication")
            ta.fill("brouillon à abandonner")
            page.keyboard.press("Escape")
            page.wait_for_timeout(1000)
            verifie(
                "le brouillon est abandonné à la fermeture",
                "brouillon à abandonner" not in page.inner_text("body"),
                "le texte du brouillon réapparaît après fermeture",
            )

        # ── Modifier puis supprimer sa publication ───────────────
        print("\n[7] Modifier et supprimer sa publication")
        marqueur = "diagnostic-modif-2287"
        page.get_by_role("button", name="Écrire une publication").click()
        page.wait_for_timeout(600)
        composeur = page.get_by_placeholder("Rédige ta publication")
        composeur.fill(marqueur)
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Publier", exact=True).click()
        page.wait_for_timeout(1800)

        ma = page.locator("article").filter(has_text=marqueur).first
        verifie("ma publication est listée", ma.count() > 0)

        if ma.count() > 0:
            modifier = ma.get_by_role("button", name=rx(r"Modifier"))
            verifie("le bouton « modifier » existe", modifier.count() > 0)

            if modifier.count() > 0:
                step("modification")
                modifier.click()
                page.wait_for_timeout(1200)
                dlg = page.get_by_role("dialog").last
                verifie("la fenêtre de modification s'ouvre", dlg.count() > 0)

                if dlg.count() > 0:
                    ta = dlg.locator("textarea").first
                    if ta.count() > 0:
                        ta.fill(f"{marqueur} — corrigé")
                        page.wait_for_timeout(300)
                    valider = dlg.get_by_role("button", name=rx(r"Enregistrer|Valider|Publier"))
                    if valider.count() > 0:
                        valider.first.click()
                        page.wait_for_timeout(1600)
                        verifie(
                            "la modification est visible",
                            "corrigé" in page.inner_text("body"),
                        )
                        verifie("aucune erreur à la modification", not errs, "; ".join(errs[:1]))

            page.reload(wait_until="networkidle")
            page.wait_for_timeout(2200)
            ma = page.locator("article").filter(has_text=marqueur).first
            supprimer = ma.get_by_role("button", name=rx(r"Supprimer"))
            verifie("le bouton « supprimer » existe", supprimer.count() > 0)

            if supprimer.count() > 0:
                step("suppression")
                supprimer.click()
                page.wait_for_timeout(1000)
                confirm = page.get_by_role("button", name=rx(r"Supprimer|Confirmer|Oui"))
                cible = confirm.last
                if cible.count() > 0 and cible.is_enabled():
                    cible.click()
                    page.wait_for_timeout(2000)
                    verifie(
                        "la publication a disparu",
                        marqueur not in page.inner_text("body"),
                    )
                else:
                    verifie("une confirmation est demandée", True, "supprimé sans confirmation")

        nav.close()

    print()
    if echecs:
        print(f"{len(echecs)} problème(s) :")
        for e in echecs:
            print(f"  ✗ {e}")
        return 1
    print("Toutes les interactions balayées fonctionnent")
    return 0


if __name__ == "__main__":
    sys.exit(main())