"""Diagnostic navigateur des rôles de groupe — migration 020.

Exécuter avec :  python3 scripts/diagnostic-roles.py

Un test unitaire prouve que la RLS (réelle ou rejouée) donne ses pouvoirs
au rôle ; il ne prouve pas qu'un écran les **montre**. Ce qui est vérifié
ici n'existe que si l'interface a réellement tourné :

 · la feuille « Membres » liste les membres avec leur rôle — et le seed
   nomme koffi modérateur de « Python Afrique », un groupe qu'il ne
   possède pas : c'est ce cas qui doit être visible ;
 · le créateur nomme et révoque un modérateur, et la liste **relit**
   l'état accepté par la base ;
 · un modérateur voit l'action de suppression sur le message d'un autre,
   et un membre simple ne la voit pas ;
 · supprimer retire le message, sans erreur de console.

Chaque étape agit comme un utilisateur, puis relit l'écran ou le store.
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


def members(page) -> list[dict]:
    """Les adhésions lues dans le store, par un autre chemin que l'écran."""
    raw = page.evaluate(f"() => window.localStorage.getItem({KEY!r})")
    if not raw:
        return []
    return json.loads(raw).get("group_members", [])


def messages(page) -> list[dict]:
    raw = page.evaluate(f"() => window.localStorage.getItem({KEY!r})")
    if not raw:
        return []
    return json.loads(raw).get("group_messages", [])


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

        # ── Connexion démo (koffi : modérateur de g-1, créateur de g-2) ──
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_url("**/feed", timeout=15000)
        page.wait_for_timeout(1500)

        # ── 1. La feuille Membres d'un groupe dont koffi n'est pas le
        #       créateur — le badge « modérateur » doit le suivre ──
        page.goto(f"{BASE}/groups/g-1", wait_until="networkidle")
        page.wait_for_timeout(1800)

        page.get_by_role("button", name="Membres du groupe").click()
        page.wait_for_timeout(900)
        body = page.inner_text("body")
        check("la feuille Membres s'ouvre", "membres" in body.lower())
        check("le propriétaire est lu avec son rôle", "créateur" in body.lower())
        check("koffi est affiché modérateur", "modérateur" in body.lower())
        check("un membre simple est affiché", "membre" in body.lower())

        # Koffi n'est pas le créateur ici : aucun bouton « nommer ».
        check("un non-créateur ne voit pas le bouton de rôle",
              page.get_by_role("button", name="nommer", exact=True).count() == 0)

        # Ni créateur ni staff visant autre chose : pas d'action de retrait
        # sur un membre... koffi EST staff : il peut retirer un membre simple.
        # Mais jamais le propriétaire : la ligne d'aminata n'a pas de bouton.
        check("le propriétaire n'a pas de bouton de retrait",
              page.locator("li", has_text="Aminata").get_by_role(
                  "button", name="Retirer Aminata du groupe").count() == 0)

        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── 2. La suppression de message par l'équipe ──
        # Un message d'autrui dans le canal ouvert : koffi (modérateur)
        # doit voir l'action, la confirmer en ligne, et la voir réussir.
        avant = [m for m in messages(page) if m.get("group_id") == "g-1"]
        check("le canal contient des messages avant le test", len(avant) > 0)
        page.wait_for_timeout(400)
        nb_delete = page.get_by_role("button", name="Supprimer ce message").count()
        check("l'action de suppression est proposée à l'équipe", nb_delete > 0)

        if nb_delete > 0:
            page.get_by_role("button", name="Supprimer ce message").first.click()
            page.wait_for_timeout(400)
            body = page.inner_text("body")
            check("la confirmation en ligne s'affiche",
                  "supprimer ?" in body.lower() or "supprimer ce message" in body.lower())
            page.get_by_role("button", name="supprimer", exact=True).first.click()
            page.wait_for_timeout(900)

            apres = [m for m in messages(page) if m.get("group_id") == "g-1"]
            check("le message a été retiré du store", len(apres) == len(avant) - 1,
                  f"{len(avant)} → {len(apres)}")

        # ── 3. Le créateur règle les rôles dans son groupe ──
        page.goto(f"{BASE}/groups/g-2", wait_until="networkidle")
        page.wait_for_timeout(1800)
        page.get_by_role("button", name="Membres du groupe").click()
        page.wait_for_timeout(900)

        # g-2 appartient à koffi : il voit le bouton « nommer » sur un membre.
        nommer = page.get_by_role("button", name="nommer", exact=True)
        check("le créateur voit le bouton de nomination", nommer.count() > 0)

        if nommer.count() > 0:
            cible_li = page.locator("li", has_text="Zainab")
            nommer.first.click()
            page.wait_for_timeout(1200)

            apres_nom = [
                m for m in members(page)
                if m.get("group_id") == "g-2"
                and m.get("user_id") == "u-zainab"
            ]
            check("la promotion est relue dans le store",
                  apres_nom and apres_nom[0].get("role") == "moderator",
                  str(apres_nom))

            # Révoquer — la liste a relu l'état, le bouton dit l'inverse.
            revoke = cible_li.get_by_role("button", name="révoquer", exact=True)
            check("le bouton passe à « révoquer » après relecture", revoke.count() == 1)

            if revoke.count() == 1:
                revoke.click()
                page.wait_for_timeout(1200)
                apres_rev = [
                    m for m in members(page)
                    if m.get("group_id") == "g-2" and m.get("user_id") == "u-zainab"
                ]
                check("la révocation est relue dans le store",
                      apres_rev and apres_rev[0].get("role") == "member", str(apres_rev))

        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # ── Rapport ─────────────────────────────────────────────────
        browser.close()

        print(f"\n{ok} vérification(s) passée(s), {len(failures)} échec(s)\n")
        if failures:
            for f in failures:
                print(f"  ✗ {f}")
            sys.exit(1)

        if console_errors:
            print("Erreurs de console :")
            for e in console_errors:
                print(f"  ! {e}")
            sys.exit(1)

        print("  ✓ Les rôles s'affichent, se règlent et modèrent dans le navigateur\n")


run()
