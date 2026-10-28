"""Robustesse du mode démonstration face à un store périmé.

Le mode démo persiste ses écritures dans `localStorage`. Un navigateur
qui a ouvert l'application **avant** une évolution du jeu de données
conserve donc un store d'une forme ancienne : tables manquantes,
colonnes absentes, compteurs jamais calculés.

C'est le scénario le plus probable d'un « chez moi des pages
n'affichent pas » : l'application est à jour, les données locales ne le
sont pas. Le store étant fusionné avec le seed à chaque chargement, il
devrait absorber la différence — et c'est ce que ce script vérifie,
page par page, puis geste par geste.

Il teste aussi le cas limite voisin : un store **corrompu** (JSON
invalide), parce que la corruption arrive autrement qu'une mise à jour —
coupure pendant l'écriture, extension, plusieurs onglets.

Exécuter avec :  python3 scripts/diagnostic-store-ancien.py
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
STORE_KEY = "devnet.demo.v6"

ROUTES = [
    "/feed", "/messages", "/groups", "/groups/g-1", "/projects",
    "/profile", "/notifications", "/moderation", "/u/koffi", "/post/p-1",
]


def store_ancien() -> str:
    """Un store de la forme d'avant les réactions et les reposts.

    On ne construit pas une vraie donnée historique : on prend la
    structure qui importa — pas de table `reactions`, pas de table
    `reposts`, pas de `last_read_at`, pas de compteur `reactions` sur les
    publications. C'est exactement ce que laisse derrière lui un
    navigateur qui n'a pas rechargé depuis l'ajout des migrations.
    """
    return json.dumps({
        "users": [
            {
                "id": "u-koffi", "prenom": "Koffi", "pseudo": "koffi",
                "email": "koffi@devnet.africa", "filiere": "Génie Logiciel",
                "niveau": "L3", "langages": ["Python"], "avatar_color": "av-lime",
                "bio": "Ancien profil", "account_type": "student", "verified": False,
                "followers": 12, "following": 8,
                "created_at": "2026-01-01T00:00:00.000Z",
            }
        ],
        "posts": [
            {
                "id": "p-1", "author_id": "u-koffi", "text": "Publication d'avant.",
                "has_code": False, "code": "", "lang": "", "likes": 34,
                "liked_by": [], "comments": 7, "created_at": "2026-09-01T10:00:00.000Z",
            }
        ],
        "group_messages": [], "conversations": [], "direct_messages": [],
        # Ancienne forme : aucun `last_read_at`.
        "conversation_members": [{"conversation_id": "c1", "user_id": "u-koffi"}],
        "channels": [], "channel_members": [
            {"channel_id": "ch-1", "user_id": "u-koffi", "role": "owner",
             "muted": False, "joined_at": "2026-01-01T00:00:00.000Z"},
        ],
        "projects": [], "project_members": [], "git_commits": [], "git_refs": [],
        "git_files": [], "git_commit_files": [], "post_projects": [],
        "notifications": [], "reports": [], "github_connections": [],
        "project_links": [], "project_sessions": [],
        "post_likes": [], "comments": [], "follows": [], "group_members": [],
        "issues": [], "issue_comments": [], "pull_requests": [], "project_pages": [],
    })


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

        # ── 1. Store d'ancienne version ─────────────────────────
        print("\n[1] Store d'ancienne version (sans réactions, sans reposts)")
        ctx = nav.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errs: list[str] = []
        page.on("pageerror", lambda e: errs.append(f"EXC {e}"))
        page.on(
            "console",
            lambda m: errs.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        page.goto(f"{BASE}/login")
        page.evaluate(
            "([k, v]) => window.localStorage.setItem(k, v)", [STORE_KEY, store_ancien()]
        )

        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_timeout(2500)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(2500)

        verifie(
            "la connexion aboutit avec un store ancien",
            "/login" not in page.url,
            page.url,
        )

        for route in ROUTES:
            errs.clear()
            page.goto(f"{BASE}{route}", wait_until="networkidle")
            page.wait_for_timeout(2000)
            corps = page.inner_text("body").strip()
            verifie(
                f"{route} rend du contenu",
                len(corps) > 200 and not errs,
                f"{len(corps)} car., erreurs={errs[:1]}",
            )

        # Le geste central : avec un store ancien, on peut-il poser une réaction.
        print("\n[2] Gestes sur un store ancien")
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_selector("article", timeout=20_000)
        page.wait_for_timeout(1500)
        errs.clear()

        reaction = page.locator("article").first.get_by_role(
            "button", name="Réagir à cette publication"
        )
        verifie("le bouton de réaction existe", reaction.count() > 0, "")

        if reaction.count() > 0:
            reaction.first.hover()
            page.wait_for_timeout(500)
            choix = page.get_by_role("button", name="Rire").first
            if choix.is_visible():
                choix.click()
                page.wait_for_timeout(1200)
                toast = page.locator("[data-toast]").first
                msg = toast.inner_text() if toast.count() > 0 else ""
                verifie(
                    "la réaction aboutit",
                    "impossible" not in msg.lower(),
                    f"toast={msg!r}",
                )
                page.reload(wait_until="networkidle")
                page.wait_for_timeout(2200)
                verifie(
                    "la réaction survit",
                    page.locator("article").first.get_by_role(
                        "button", name="Changer ta réaction"
                    ).count() > 0,
                )

        # Lire un message : c'est le geste qui dépend de `last_read_at`,
        # une colonne que ce store n'a pas.
        page.goto(f"{BASE}/messages", wait_until="networkidle")
        page.wait_for_timeout(2000)
        verifie(
            "les messages s'affichent malgré l'absence de last_read_at",
            len(page.inner_text("body").strip()) > 200,
        )

        ctx.close()

        # ── 2. Store corrompu ───────────────────────────────────
        print("\n[3] Store corrompu (JSON invalide)")
        ctx2 = nav.new_context(viewport={"width": 1280, "height": 900})
        page2 = ctx2.new_page()
        errs2: list[str] = []
        page2.on("pageerror", lambda e: errs2.append(f"EXC {e}"))
        page2.on(
            "console",
            lambda m: errs2.append(f"CONSOLE {m.text}") if m.type == "error" else None,
        )

        page2.goto(f"{BASE}/login")
        page2.evaluate(
            "([k, v]) => window.localStorage.setItem(k, v)",
            [STORE_KEY, '{"posts": [ {"id": "p-1", "text": "cassé"'],
        )
        page2.goto(f"{BASE}/feed", wait_until="networkidle")
        page2.wait_for_timeout(2500)
        verifie(
            "l'application démarre malgré un store corrompu",
            len(page2.inner_text("body").strip()) > 200 and not errs2,
            f"erreurs={errs2[:1]}",
        )

        # Un store « vide » : toutes les tables présentes mais vides.
        page2.evaluate(
            "([k, v]) => window.localStorage.setItem(k, v)", [STORE_KEY, "{}"]
        )
        errs2.clear()
        page2.goto(f"{BASE}/feed", wait_until="networkidle")
        page2.wait_for_timeout(2500)
        verifie(
            "l'application démarre avec un store vide",
            len(page2.inner_text("body").strip()) > 200 and not errs2,
            f"erreurs={errs2[:1]}",
        )

        ctx2.close()
        nav.close()

    print()
    if echecs:
        print(f"{len(echecs)} problème(s) :")
        for e in echecs:
            print(f"  ✗ {e}")
        return 1
    print("Le mode démonstration encaisse un store périmé ou corrompu")
    return 0


if __name__ == "__main__":
    sys.exit(main())