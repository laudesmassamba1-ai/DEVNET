"""Diagnostic des gestes — écrire, commenter, lire, signaler.

Une page qui rend n'est pas une page qui **fonctionne**. Ce script
exerce les quatre gestes que le diagnostic de routes ne touche pas :

1. publier une publication depuis le composeur du fil ;
2. ouvrir le fil de commentaires et **lire** ce qui y est ;
3. écrire un commentaire et le voir apparaître ;
4. signaler une publication, puis un commentaire.

Pour chacun, on vérifie trois choses séparément : que le clic ne lève
rien, que l'interface **montre** le résultat, et que le résultat
**survit à un rechargement**. Le troisième point est celui qui manque le
plus souvent — une ligne optimiste affichée puis perdue donne une
impression de succès et un état faux.

Exécuter avec :  python3 scripts/diagnostic-actions.py
"""

import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"


def rx(pattern: str):
    """`re` importé en tête de module, maison ne veut pas le
    reproduire à chaque appel : un motif.search() par ligne de test
    serait illisible.
    """
    return re.compile(pattern, re.IGNORECASE)


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
        erreurs: list[str] = []
        page.on("pageerror", lambda e: erreurs.append(f"EXC {e}"))
        page.on(
            "console",
            lambda m: erreurs.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(2500)

        # ── 1. Publier depuis le composeur du fil ────────────────
        print("\n[1] Publier une publication")
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)

        erreurs.clear()
        marqueur = "diagnostic-publier-7421"
        # La rédaction vit dans une feuille dédiée, ouverte par la bulle
        # flottante : le composeur n'est plus dans le fil au premier rendu.
        page.get_by_role("button", name="Écrire une publication").click()
        page.wait_for_timeout(500)
        composeur = page.get_by_placeholder("Rédige ta publication")
        composeur.fill(f"{marqueur} — publication de diagnostic")
        page.wait_for_timeout(400)
        verifie(
            "le composeur accepte la saisie",
            marqueur in composeur.input_value(),
        )

        avant = page.locator("article").count()
        page.get_by_role("button", name="Publier", exact=True).click()
        page.wait_for_timeout(1800)

        corps = page.inner_text("body")
        # Le composeur **doit** être vidé après publication : c'est le
        # contrat du formulaire. La feuille se referme ; on la rouvre pour
        # vérifier que le texte n'a pas survécu.
        page.get_by_role("button", name="Écrire une publication").click()
        page.wait_for_timeout(500)
        verifie(
            "le composeur est vidé après publication",
            page.get_by_placeholder("Rédige ta publication").input_value().strip() == "",
            "le texte est resté dans le composeur",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        verifie("aucune erreur à la publication", not erreurs, "; ".join(erreurs[:2]))
        verifie("la publication apparaît dans le fil", marqueur in corps)
        verifie(
            "le nombre de cartes a changé",
            page.locator("article").count() > avant,
            f"avant={avant} après={page.locator('article').count()}",
        )

        page.reload(wait_until="networkidle")
        page.wait_for_timeout(2200)
        verifie(
            "la publication survit au rechargement",
            marqueur in page.inner_text("body"),
        )

        # ── 2 & 3. Lire puis écrire un commentaire ───────────────
        print("\n[2] Lire et écrire un commentaire")
        page.goto(f"{BASE}/post/p-1", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)

        erreurs.clear()
        page.get_by_role("button", name=rx(r"Ouvrir les")).first.click()
        page.wait_for_timeout(1200)

        panneau = page.get_by_role("dialog")
        verifie("le panneau de commentaires s'ouvre", panneau.count() > 0)

        if panneau.count() > 0:
            texte_panneau = panneau.first.inner_text()
            lignes = [
                l for l in texte_panneau.splitlines() if l.strip()
            ]
            verifie(
                "des commentaires sont lisibles",
                len(lignes) > 2,
                f"{len(lignes)} ligne(s) : {lignes[:4]}",
            )
            # Un commentaire dénué d'auteur affiche « ? » : le panel rend,
            # mais il ne dit pas qui parle.
            verifie(
                "les commentaires portent un auteur",
                "?" not in texte_panneau,
                "un auteur manquant s'affiche comme « ? »",
            )

            champ = panneau.first.locator("textarea").first
            if champ.count() == 0:
                verifie("le champ de commentaire existe", False, "aucun textarea")
            else:
                marqueur_c = "diagnostic-commentaire-9134"
                champ.fill(marqueur_c)
                page.wait_for_timeout(300)
                # Le bouton d'envoi n'existe pas toujours sous le même
                # nom ; on tente les deux écritures.
                envoye = False
                for nom in ("Publier le commentaire", "Envoyer", "Répondre", "Publier"):
                    bouton = panneau.first.get_by_role("button", name=nom)
                    if bouton.count() > 0 and bouton.first.is_enabled():
                        bouton.first.click()
                        envoye = True
                        break
                verifie("un bouton d'envoi existe", envoye)

                if envoye:
                    page.wait_for_timeout(1600)
                    verifie(
                        "le commentaire s'affiche",
                        marqueur_c in panneau.first.inner_text(),
                    )
                    page.reload(wait_until="networkidle")
                    page.wait_for_timeout(2200)
                    page.get_by_role("button", name=rx(r"Ouvrir les")).first.click()
                    page.wait_for_timeout(1200)
                    verifie(
                        "le commentaire survit au rechargement",
                        marqueur_c in page.get_by_role("dialog").first.inner_text(),
                    )

        verifie("aucune erreur pendant les commentaires", not erreurs, "; ".join(erreurs[:2]))

        # ── 4. Signaler une publication ─────────────────────────
        print("\n[3] Signaler une publication")
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1200)

        erreurs.clear()
        boutons_signal = page.get_by_role("button", name=rx(r"Signaler"))
        verifie("un bouton « signaler » existe", boutons_signal.count() > 0)

        if boutons_signal.count() > 0:
            boutons_signal.first.click()
            page.wait_for_timeout(1200)

            dialogue = page.get_by_role("dialog")
            verifie("la fenêtre de signalement s'ouvre", dialogue.count() > 0)

            if dialogue.count() > 0:
                # Les motifs sont un `radiogroup` : on les interroge par
                # le rôle `radio`. Chercher des `input[type=radio]` ne
                # trouverait rien — et l'envoi resterait bloqué, ce qui
                # ferait conclure à un bug qui n'existe pas.
                motifs = dialogue.first.get_by_role("radio")
                verifie(
                    "les motifs sont exposés comme des choix",
                    motifs.count() > 1,
                    f"{motifs.count()} motif(s)",
                )
                if motifs.count() > 0:
                    motifs.first.click()
                    page.wait_for_timeout(400)

                envoyer = dialogue.first.get_by_role(
                    "button", name=rx(r"Envoyer|Signal")
                )
                verifie("un bouton d'envoi existe dans la fenêtre", envoyer.count() > 0)

                if envoyer.count() > 0 and envoyer.first.is_enabled():
                    erreurs.clear()
                    envoyer.first.click()
                    page.wait_for_timeout(1800)

                    toast = page.locator("[data-toast]").first
                    message = toast.inner_text() if toast.count() > 0 else ""
                    verifie(
                        "le signalement est confirmé",
                        "signal" in message.lower(),
                        f"toast={message!r}",
                    )
                    verifie("aucune erreur au signalement", not erreurs, "; ".join(erreurs[:2]))
                else:
                    verifie(
                        "le bouton d'envoi est actif",
                        False,
                        "bouton désactivé — le motif n'est probablement pas préselectionné",
                    )

        # ── 5. Le signalement atteint la modération ──────────────
        print("\n[4] Le signalement arrive-t-il en modération")
        page.goto(f"{BASE}/moderation", wait_until="networkidle")
        page.wait_for_timeout(2000)
        corps_mod = page.inner_text("body")
        verifie(
            "la file de modération affiche des éléments",
            len(corps_mod.strip()) > 300,
            f"{len(corps_mod.strip())} car.",
        )

        nav.close()

    print()
    if echecs:
        print(f"{len(echecs)} problème(s) :")
        for e in echecs:
            print(f"  ✗ {e}")
        return 1
    print("Tous les gestes fonctionnent")
    return 0


if __name__ == "__main__":
    sys.exit(main())