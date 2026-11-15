"""Diagnostic navigateur des profondeurs sociales — 018 et GitHub.

Exécuter avec :  python3 scripts/diagnostic-profond.py

Ce script existe parce qu'un test unitaire ne voit pas si un composant est
**monté**. Les quatre fonctionnalités vérifiées ici vivent toutes dans un
écran (ou une feuille) : une réponse de commentaire qui ne s'imbrique pas,
une réaction de message qui ne s'affiche pas, une story qui ne se publie
pas, un onglet GitHub qui ne rend rien — aucun `tsc`, aucun test pur ne
les aurait vus.

Chaque étape agit comme un utilisateur, puis relit ce qui est à l'écran.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

ok = 0
failures: list[str] = []
console_errors: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    if cond:
        ok += 1
    else:
        failures.append(f"{name}{f' → {detail}' if detail else ''}")


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
        page.wait_for_timeout(2000)

        # ── 1. Stories réelles ─────────────────────────────────────
        rail = page.get_by_text("Dernières contributions")
        check("le rail de stories est monté", rail.count() > 0)

        # Le seed contient deux stories vivantes (koffi, aminata) et une
        # périmée (thabo) : la périmée ne doit apparaître **nulle part**.
        rail_text = page.inner_text("body")
        check("la story vivante de koffi est dans le rail",
              "@koffi" in rail_text or "koffi" in rail_text)
        check("la story périmée n'apparaît pas",
              "Writeup du CTF publié" not in rail_text)

        # Publier une story.
        add_story = page.get_by_role("button", name="Votre story")
        check("le cercle de publication est présent", add_story.count() > 0)
        add_story.first.click()
        page.wait_for_timeout(600)
        check("la feuille de story s'ouvre",
              page.get_by_text("Nouvelle story").count() > 0)

        # Le libellé est propre au composeur de story : un match partiel
        # tomberait sur le composeur du fil (strict mode violation).
        story_box = page.get_by_placeholder("Ta story")
        story_box.fill("Diagnostic : une story publiée depuis le test.")
        page.get_by_role("button", name="Publier", exact=True).last.click()
        page.wait_for_timeout(1500)
        check("la story publiée ouvre son cercle",
              page.get_by_text("vous", exact=True).count() > 0)

        # ── 2. Réponses de commentaires ────────────────────────────
        page.goto(f"{BASE}/post/p-1", wait_until="networkidle")
        page.wait_for_timeout(1800)
        page.get_by_role("button", name="Ouvrir les").first.click()
        page.wait_for_timeout(1200)

        # Une réponse du seed (« ma spécialité ») doit être rendue — c'est
        # la preuve que `parent_id` est bien lu et affiché. Elle vit dans
        # un conteneur de réponse (gouttière gauche).
        check("une réponse du seed est affichée",
              page.get_by_text("spécialité").count() > 0)
        check("les réponses sont imbriquées (gouttière)",
              page.locator('div[class*="ml-[19px]"]').count() > 0,
              str(page.locator('div[class*="ml-[19px]"]').count()))

        page.get_by_role("button", name="Répondre", exact=True).first.click()
        page.wait_for_timeout(300)
        check("le bandeau de réponse apparaît",
              page.get_by_text("Réponse à").count() > 0)

        reply_box = page.get_by_placeholder("Répondre…")
        reply_box.fill("Diagnostic : voici une réponse imbriquée.")
        page.get_by_role("button", name="Publier le commentaire").click()
        page.wait_for_timeout(1500)
        check("la réponse publiée est visible",
              page.get_by_text("Diagnostic : voici une réponse imbriquée.").count() > 0)

        # ── 3. Réactions de message ────────────────────────────────
        # On ouvre la conversation par la **liste**, pas par `?to=` :
        # `startConversation` calcule l'identifiant de conversation à
        # partir des participants, alors que le seed en a des lisible ;
        # `?to=` créerait donc une seconde conversation, vide. La liste,
        # elle, ouvre celle du seed — avec ses messages.
        page.goto(f"{BASE}/messages", wait_until="networkidle")
        page.wait_for_timeout(2000)
        page.locator("button", has_text="Thabo").first.click()
        page.wait_for_timeout(1800)
        check("la conversation s'ouvre sur un message du seed",
              page.get_by_text("CTF", exact=False).count() > 0)

        react = page.get_by_role("button", name="Réagir", exact=True)
        check("la barre d'action des messages est montée", react.count() > 0)

        if react.count() > 0:
            react.first.click()
            page.wait_for_timeout(300)
            # Le rire n'existe sur aucun message privé du seed : la pastille qui
            # apparaît est donc forcément celle qu'on vient de poser.
            page.get_by_role("button", name="Réagir \U0001F602").first.click()
            page.wait_for_timeout(1200)
            check("la réaction posée s'affiche",
                  page.locator('button[aria-label*="Réaction \U0001F602"]').count() > 0,
                  str(page.locator('button[aria-label*="Réaction \U0001F602"]').count()))

        # Répondre dans la conversation : le message cité doit apparaître.
        reply_msg = page.get_by_role("button", name="Répondre à ce message")
        check("le bouton réponse de message est présent", reply_msg.count() > 0)
        if reply_msg.count() > 0:
            reply_msg.first.click()
            page.wait_for_timeout(300)
            check("le bandeau de réponse du message apparaît",
                  page.get_by_text("Réponse à").count() > 0)
            page.get_by_role("button", name="Annuler la réponse").click()
            page.wait_for_timeout(200)

        # ── 4. GitHub ──────────────────────────────────────────────
        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle")
        page.wait_for_timeout(1800)
        tab = page.get_by_role("tab", name="GitHub")
        check("l'onglet GitHub existe", tab.count() > 0)
        tab.first.click()
        page.wait_for_timeout(1200)

        project_text = page.inner_text("body")
        check("la connexion GitHub du seed est affichée",
              "@koffi-devnet" in project_text)
        check("le dépôt lié est affiché",
              "cooperative-numerique" in project_text)
        # Le plan explique ce qu'une synchronisation ferait — c'est la
        # promesse de l'écran.
        check("un plan de synchronisation est affiché",
              "Manuel" in project_text or "synchronisation" in project_text.lower())

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
    print("  ✓ Les profondeurs sociales fonctionnent dans le navigateur\n")


if __name__ == "__main__":
    main()
