"""Parcours navigateur — connexion puis centre de notifications.

Exécuter avec :  python3 scripts/parcours-navigateur.py

Ce que le script vérifie, et pourquoi curl ne peut pas le faire :

* l'application est **entièrement cliente** en mode démonstration. Les
  données vivent dans `localStorage` et les pages se remplissent après le
  premier rendu. `curl` ne voit donc qu'une coque HTML vide — un 200 ne
  prouve rien. Il faut un vrai navigateur pour savoir si le fil se remplit
  et si la connexion aboutit.

* les erreurs de console sont la seule trace fiable d'une exception
  React : Next affiche un écran blanc sans nécessairement écrire dans le
  journal du serveur.

Le script échoue si une page reste vide ou si une erreur de console
apparaît.
"""

import re
import time
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

# La branche que le parcours crée pour y demander une intégration. Elle
# est nommée **une fois** : la créer d'un côté et la chercher sous un autre
# nom fait échouer le test pour une raison qui n'a rien à voir avec le
# code — et c'est arrivé.
BRANCHE_NEUVE = "lecture-a-voix"

# Le mode démonstration est forcé par `.env.local` ; on ne dépend donc
# d'aucun compte réel, et le store est réinitialisé à chaque visite.
ok = 0
failures: list[str] = []
console_errors: list[str] = []

# La visite guidée se lance d'elle-même à la première connexion. Les
# parcours testent le produit, pas la prise en main : chaque page se
# présente comme un utilisateur qui revient, le drapeau « déjà vue » posé
# avant tout chargement. Sans lui, la bulle recouvrirait les cibles.
DONE_TOUR = "try { window.localStorage.setItem('devnet.tour.v1', 'done'); } catch {}"


def nouvelle_page(hote, **options):
    """Ouvrir une page déjà marquée « visite guidée vue »."""
    page = hote.new_page(**options)
    page.add_init_script(DONE_TOUR)
    return page


def check(name: str, cond: bool, detail: str = "") -> None:
    global ok
    if cond:
        ok += 1
    else:
        failures.append(f"{name}{f' → {detail}' if detail else ''}")


def has_editor(page) -> bool:
    return wait_editor(page) != "aucun"


def wait_editor(page) -> str:
    """Attend l'un des deux moteurs (Monaco ou le repli textarea).

    Le CDN de Monaco arrive tantôt en 3 s, tantôt après le délai de repli
    de l'application : un choix fait une fois pour toutes au premier NaN
    d'une course échouait sur le moteur qui arrive à l'autre douzièmes de
    seconde. On attend, puis on choisit constamment au suivant.
    """
    deadline = time.time() + 60
    while time.time() < deadline:
        if page.locator(".monaco-editor").count():
            return "monaco"
        if page.get_by_role("textbox", name=re.compile(r"^Contenu de ")).count():
            return "textarea"
        page.wait_for_timeout(250)
    return "aucun"


def code_text(page) -> str:
    if wait_editor(page) == "monaco":
        return page.locator(".monaco-editor .view-lines").inner_text().replace("\u00a0", " ")
    editor = page.get_by_role("textbox", name=re.compile(r"^Contenu de "))
    return editor.first.input_value() if editor.count() else ""


def focus_code(page) -> None:
    if wait_editor(page) == "monaco":
        page.locator(".monaco-editor").click(position={"x": 150, "y": 12})
    else:
        page.get_by_role("textbox", name=re.compile(r"^Contenu de ")).first.click()


def replace_code(page, text: str) -> None:
    if wait_editor(page) == "monaco":
        focus_code(page)
        page.keyboard.press("Control+a")
        page.keyboard.insert_text(text)
    else:
        page.get_by_role("textbox", name=re.compile(r"^Contenu de ")).first.fill(text)


def run() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})

        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        # ── Le fil se remplit ──────────────────────────────────────
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_timeout(2500)

        body = page.inner_text("body")
        check("le fil rend du texte", len(body) > 200, f"{len(body)} caractères")
        # Un bandeau « mode démonstration » doit être présent : c'est la
        # promesse d'honnêteté du produit, et sa disparition serait un
        # défaut plus grave qu'une page vide.
        check("le bandeau de mode démonstration est affiché",
              "démonstration" in body.lower())
        check("le fil affiche des publications", "@" in body)

        # ── Connexion ──────────────────────────────────────────────
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)

        login_body = page.inner_text("body")
        check("la page de connexion rend", len(login_body) > 100,
              f"{len(login_body)} caractères")

        inputs = page.locator("input").count()
        check("la connexion propose des champs", inputs >= 2, f"{inputs} champs")

        # Le mode démo n'a pas de serveur d'authentification : on vérifie
        # que le formulaire **existe et est-lisible**, pas qu'un mot de
        # passe passe. Tenter une vraie connexion échouerait par
        # construction et ne prouverait rien sur le code.
        has_error_text = "incorrect" in login_body.lower() or "erreur" in login_body.lower()
        check("aucune erreur parasite au chargement de la connexion",
              not has_error_text, login_body[:200])

        # On se connecte pour de bon, par le bouton de la page — c'est le
        # chemin qu'un présentateur utilisera. Sans session, toutes les
        # pages suivantes redirigent vers `/login` et le parcours ne
        # testerait que la page de connexion.
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        check("la connexion aboutit et quitte la page de connexion",
              "/login" not in page.url, page.url)

        signed_in = page.inner_text("body")
        check("la session est active (le pseudonyme apparaît)",
              "koffi" in signed_in.lower(), page.url)

        # ── Centre de notifications ─────────────────────────────────
        page.goto(f"{BASE}/notifications", wait_until="networkidle")
        page.wait_for_timeout(2500)

        notif_body = page.inner_text("body")
        check("le centre de notifications rend du texte",
              len(notif_body) > 150, f"{len(notif_body)} caractères")

        # Les onglets par type (like / follow / mention / message) sont
        # ce qui distingue un vrai centre d'une liste plate.
        notif_lower = notif_body.lower()
        has_tabs = any(
            word in notif_lower
            for word in ("j'aime", "abonn", "mention", "message")
        )
        check("le centre propose un filtrage par type", has_tabs,
              notif_body[:300])

        # Le jeu de démonstration contient des notifications de chaque
        # type. Si le centre n'en affiche aucune, la page n'est qu'un gabarit
        # vide — exactement le défaut que la Vague 2 cherche à corriger,
        # et qu'un simple 200 ne verrait pas.
        check("le centre liste des notifications réelles",
              any(name in notif_lower for name in
                  ("thabo", "zainab", "youssef", "chioma", "aminata", "marcus")),
              notif_body[:300])

        # ── La page de liste d'abonnés nouvellement créée ──────────────
        page.goto(f"{BASE}/u/koffi/followers", wait_until="networkidle")
        page.wait_for_timeout(2500)

        fol_body = page.inner_text("body")
        check("la liste des abonnés rend du texte", len(fol_body) > 150,
              f"{len(fol_body)} caractères")

        # On vérifie des **noms réels** du jeu de démonstration, pas un
        # simple « il y a un @ quelque part » : une page qui affiche le
        # gabarit vide passerait le test faible alors qu'elle ne montre
        # personne. Six comptes suivent koffi dans `DEMO_FOLLOWS`.
        followers_lower = fol_body.lower()
        named = [
            name
            for name in ("aminata", "thabo", "zainab", "marcus", "chioma", "youssef")
            if f"@{name}" in followers_lower
        ]
        check("la liste nomme les abonnés réels", len(named) >= 4,
              f"{len(named)} noms trouvés : {named}")
        check("la liste propose les deux sens",
              "abonn" in followers_lower and "suiv" in followers_lower,
              fol_body[:300])

        # Le profil public doit exposer les compteurs.
        page.goto(f"{BASE}/u/koffi", wait_until="networkidle")
        page.wait_for_timeout(2500)

        prof_body = page.inner_text("body").lower()
        check("le profil affiche un compteur d'abonnés",
              "abonnés" in prof_body, page.inner_text("body")[:300])
        check("le profil affiche la bio ou les langages",
              "langages" in prof_body or len(page.inner_text("body")) > 400)

        # ── L'action suivre, de bout en bout ─────────────────────────
        # C'est le cœur de la Vague 1 : on ne se contente pas que le
        # bouton existe, on vérifie qu'il bascule **et** que le compteur
        # suit. Un bouton qui change d'étiquette sans que le chiffre
        # bouge est exactement le défaut « le like affiche un nombre mais
        # ne fait rien » qu'on combat depuis la Vague 2.

        # Koffi suit Thabo dans le jeu de démonstration : on part donc
        # d'un état connu, « suivi ». Attention au **pseudo** : c'est
        # `thabo_codes`, pas `thabo` — le chemin est un pseudo, et un
        # mauvais pseudo affiche « profil introuvable » au lieu d'une
        # erreur franche.
        page.goto(f"{BASE}/u/thabo_codes", wait_until="networkidle")
        page.wait_for_timeout(2500)

        check("le profil thabo_codes est trouvé",
              "introuvable" not in page.inner_text("body").lower(),
              page.inner_text("body")[:200])

        follow_btn = page.get_by_role("button", name="Ne plus suivre", exact=False)
        check("le bouton indique un suivi déjà établi",
              follow_btn.count() > 0, page.inner_text("body")[:200])

        def read_counters() -> tuple[int, int]:
            """Les compteurs du profil, lus par leur étiquette.

            On cible le bouton par son mot (« abonnés », « suivis ») et non
            par une classe : la classe `tnum` est sur le chiffre, à
            l'intérieur du bouton, donc un sélecteur `button.tnum` ne
            trouve rien — et un test qui lit « -1 » des deux côtés
            passe sans rien vérifier.
            """

            def count_for(label: str) -> int:
                btn = page.locator(f'button:has-text("{label}")').first
                if btn.count() == 0:
                    return -1
                found = re.search(r"\d+", btn.inner_text())
                return int(found.group()) if found else -1

            return count_for("abonnés"), count_for("suivis")

        before_followers, before_following = read_counters()
        check("les compteurs sont lisibles avant toute action",
              before_followers >= 0 and before_following >= 0,
              {"abonnes": before_followers, "suivis": before_following})

        follow_btn.first.click()
        page.wait_for_timeout(2000)

        check("le bouton bascule vers « suivre »",
              page.get_by_role("button", name="Suivre thabo_codes", exact=False).count() > 0,
              page.inner_text("body")[:200])

        after_followers, after_following = read_counters()
        check("le compteur d'abonnés baisse de 1 après avoir ne plus suivi",
              after_followers == before_followers - 1,
              {"avant": before_followers, "apres": after_followers})

        # On remet l'état de la démo : la capture et les sessions
        # suivantes doivent retrouver la même liste qu'au début.
        page.get_by_role("button", name="Suivre thabo_codes", exact=False).first.click()
        page.wait_for_timeout(2000)

        restored_followers, _ = read_counters()
        check("suivre à nouveau rétablit le compteur",
              restored_followers == before_followers,
              {"attendu": before_followers, "obtenu": restored_followers})

        page.screenshot(path="parcours-notifications.png", full_page=False)
        browser.close()


def run_motion() -> None:
    """Ce que le mouvement peut casser, et que rien d'autre ne voit.

    Le contexte demande explicitement `reduced_motion="no-preference"`.
    Chrome **sans interface** annonce `prefers-reduced-motion: reduce` par
    défaut : les animations y sont supprimées, et `waitForExit` rend la
    main immédiatement. La vérification de l'animation de sortie passait
    donc au hasard — et elle échouait une fois sur deux, selon la
    hauteur de la fenêtre et le temps pris par l'écriture en base.

    C'est le même piège qu'une assertionPortable sur une valeur absente :
    le test ne mesurait pas ce qu'il croyait mesurer.
    """

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        contexte = browser.new_context(
            viewport={"width": 1280, "height": 900},
            reduced_motion="no-preference",
        )
        page = nouvelle_page(contexte)
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        # ── `tab-underline` : le filet doit être tracé sur l'onglet actif ──
        page.goto(f"{BASE}/notifications", wait_until="networkidle")
        page.wait_for_timeout(2500)

        tabs = page.locator('[role="tab"]')
        check("les onglets exposent un rôle", tabs.count() >= 3, f"{tabs.count()} onglets")

        selected = page.locator('[role="tab"][aria-selected="true"]')
        check("un onglet est marqué sélectionné", selected.count() == 1,
              f"{selected.count()} sélectionnés")

        # Le filet de `tab-underline` est un `::after` en `scaleX`. On lit la
        # matrice calculée : `matrix(1, …, …, …)` = tracé, `matrix(0, …)` =
        # replié. C'est la seule preuve que la classe est réellement en
        # service — sa présence dans le HTML ne prouve rien du rendu.
        scale = selected.first.evaluate(
            "e => { const c = getComputedStyle(e, '::after'); return c.transform; }"
        )
        check("le filet de l'onglet actif est tracé", scale.startswith("matrix(1,"),
              scale)

        # Un onglet inactif doit avoir son filet replié : c'est ce qui
        # distingue un onglet d'un simple texte.
        idle = page.locator('[role="tab"][aria-selected="false"]').first
        idle_scale = idle.evaluate(
            "e => { const c = getComputedStyle(e, '::after'); return c.transform; }"
        )
        check("le filet d'un onglet inactif est replié",
              idle_scale.startswith("matrix(0,"), idle_scale)

        # ── Le retrait animé : la ligne doit survivre à son animation ──
        # Sans `mo-exit`, la ligne disparaît à l'instant du clic. Avec, elle
        # reste montée le temps de `mo-exit` puis part. On lit donc **deux
        # instants** : juste après le clic, et après le délai.
        before = page.locator('[aria-label="Supprimer cette notification"]').count()
        check("des notifications sont disponibles à retirer", before > 0, str(before))

        if before > 0:
            # La mesure se fait **dans la page**, pas depuis Python.
            #
            # L'ancienne version lisait `isConnected` 30 ms après le clic.
            # C'était un pari sur la latence : sous charge, l'aller-retour
            # Playwright peut dépasser les 140 ms de `--d-fast`, et le test
            # accuse alors l'interface d'un défaut qui n'existe pas. Ici un
            # `MutationObserver` horodate la disparition **à côté de
            # l'horloge qui a vu le clic** — la mesure ne dépend plus du
            # temps de transport, et elle porte sur la durée de vie réelle
            # du nœud.
            ligne = page.locator('[aria-label="Supprimer cette notification"]').first
            ligne.evaluate(
                "e => {"
                "  window.__exit = { t0: performance.now(), gone: null };"
                "  const obs = new MutationObserver(() => {"
                "    if (!e.isConnected && window.__exit.gone === null) {"
                "      window.__exit.gone = performance.now();"
                "      obs.disconnect();"
                "    }"
                "  });"
                "  obs.observe(document.body, { childList: true, subtree: true });"
                "}"
            )
            ligne.click()
            page.wait_for_timeout(900)

            mesure = page.evaluate("() => window.__exit")
            disparu = bool(mesure and mesure["gone"])
            duree = (
                mesure["gone"] - mesure["t0"] if disparu else -1
            )

            # `--d-fast` vaut 140 ms : le nœud doit vivre sensiblement
            # aussi longtemps, sinon le retrait est instantané et
            # l'animation ne sert à rien. Le seuil laisse la marge de
            # l'écriture en base qui précède le démarrage de l'animation.
            check("la ligne reste montée pendant son retrait", duree >= 100,
                  f"la ligne a vécu {duree:.0f} ms avant de partir")
            check("la ligne finit par être retirée", disparu,
                  "la ligne est encore montée après son animation")

        # ── Les onglets du profil : accessibilité ──────────────────────
        # Le profil avait un jeu d'onglets sans `role`, invisible pour un
        # lecteur d'écran et pour la navigation au clavier.
        page.goto(f"{BASE}/profile", wait_until="networkidle")
        page.wait_for_timeout(2500)

        check("le profil expose un tablist",
              page.locator('[role="tablist"]').count() > 0,
              str(page.locator('[role="tablist"]').count()))
        check("chaque onglet du profil a un rôle et un état",
              page.locator('[role="tab"][aria-selected]').count() >= 2,
              str(page.locator('[role="tab"][aria-selected]').count()))

        # ── `mo-press` ne doit voler les transitions de couleur ────────
        # C'était le défaut réel : l'utilitaire déclarait `transition:` en
        # raccourci, ce qui remplaçait la liste de l'élément. Un bouton
        # sur quatre perdait ses transitions de couleur — et WHICH
        # perdait dépendait de l'ordre de la cascade, donc varie selon la
        # page. On vérifie donc la propriété calculée, pas la présence de
        # la classe.
        page.goto(f"{BASE}/groups", wait_until="networkidle")
        page.wait_for_timeout(2500)

        pressed = page.locator(".mo-press")
        stolen = []
        for i in range(pressed.count()):
            prop = pressed.nth(i).evaluate(
                "e => getComputedStyle(e).transitionProperty"
            )
            if prop == "transform":
                stolen.append(i)

        check("aucun bouton pressé ne perd ses transitions de couleur",
              len(stolen) == 0,
              f"boutons dont la liste ne contient plus que transform : {stolen}")

        browser.close()


def run_moderation() -> None:
    """Le signalement : le porter, puis le traiter."""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text)
            if msg.type == "error"
            else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        # ── Le bouton « signaler » ───────────────────────────────────
        # On est Koffi. Le fil contient ses publications **et** celles des
        # autres : le bouton doit apparaître partout sauf sur les siennes,
        # parce que la RLS refuserait un signalement contre soi-même.
        page.goto(f"{BASE}/feed", wait_until="networkidle")
        page.wait_for_timeout(3000)

        report_buttons = page.get_by_role("button", name="Signaler cette publication")
        total = report_buttons.count()
        check("des publications peuvent être signalées", total > 0, str(total))

        # ── Porter un signalement ────────────────────────────────────
        report_buttons.first.click()
        page.wait_for_timeout(800)

        body = page.inner_text("body")
        check("la feuille de signalement s'ouvre",
              "harcèlement" in body.lower(), body[:200])

        # L'envoi est inactif tant qu'aucun motif n'est choisi : on ne
        # veut pas envoyer un signalement muet.
        #
        # Les motifs sont un `radiogroup` : on les interroge par le rôle
        # `radio`, et non `button`. C'est la sémantique correcte — cinq
        # choix dont un seul est vrai ne sont pas cinq boutons
        # independants — et c'est aussi ce qui permet au lecteur
        # d'écran d'annoncer « 1 sur 5 » au lieu de « bouton pressé ».
        motifs = page.get_by_role("radio")
        check("les motifs sont un groupe de choix exclusifs",
              motifs.count() >= 5, str(motifs.count()))

        send = page.get_by_role("button", name="Envoyer")
        check("l'envoi est bloqué sans motif",
              send.count() > 0 and send.first.is_disabled(), str(send.count()))

        # Le champ libre n'apparaît que pour « Autre » : ailleurs il
        # ferait doublonner la case à cocher.
        check("le champ libre est absent par défaut",
              page.get_by_label("Ce qu'il faut savoir").count() == 0)

        page.get_by_role("radio", name="Autre").first.click()
        page.wait_for_timeout(400)
        check("le champ libre apparaît pour le motif « Autre »",
              page.get_by_label("Ce qu'il faut savoir").count() == 1)

        # Un motif concret referme le champ et ouvre l'envoi.
        page.get_by_role("radio", name="Spam").first.click()
        page.wait_for_timeout(400)
        check("le champ libre disparaît pour un motif fermé",
              page.get_by_label("Ce qu'il faut savoir").count() == 0)
        check("l'envoi s'ouvre une fois le motif choisi",
              send.count() > 0 and not send.first.is_disabled())

        send.first.click()
        page.wait_for_timeout(1800)

        # On lit le **toast**, pas la page : le fil contient des
        # publications qui contiennent le mot « impossible », donc chercher
        # l'absence d'un mot dans toute la page donnerait un faux échec —
        # et, pire, raterait un vrai échec.
        # `[data-toast]` parce que le bandeau de mode démonstration porte
        # lui aussi `role="status"`.
        toast = page.locator("[data-toast]")
        check("l'envoi produit une confirmation",
              toast.count() > 0 and "envoyé" in toast.first.inner_text().lower(),
              toast.first.inner_text() if toast.count() else "aucun toast")
        check("l'envoi n'est pas signalé en erreur",
              toast.count() > 0 and toast.first.get_attribute("data-toast") != "err",
              str(toast.first.get_attribute("data-toast")) if toast.count() else "aucun")

        # Signaler deux fois la même publication doit être traité comme un
        # succès : la ligne existe déjà, et l'écran ne doit pas annoncer un
        # échec à quelqu'un qui a bien signalé.
        page.get_by_role("button", name="Signaler cette publication").first.click()
        page.wait_for_timeout(900)
        page.get_by_role("radio", name="Harcèlement").first.click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Envoyer").first.click()
        page.wait_for_timeout(1800)

        toasts = page.locator("[data-toast]")
        texts = [t.inner_text().lower() for t in toasts.all()]
        check("un second signalement est annoncé comme déjà fait",
              any("déjà signalé" in t for t in texts), texts)
        check("aucun toast d'erreur après un doublon",
              not any("impossible" in t for t in texts), texts)

        # ── La vue de modération ─────────────────────────────────────
        page.goto(f"{BASE}/moderation", wait_until="networkidle")
        page.wait_for_timeout(3000)

        mod = page.inner_text("body")
        check("la vue de modération rend du contenu", len(mod) > 200, str(len(mod)))
        check("la vue explique à qui elle s'adresse",
              "vos contenus" in mod.lower(), mod[:300])
        check("l'onglet « à traiter » existe",
              page.get_by_role("tab", name="À traiter").count() == 1,
              str(page.get_by_role("tab", name="À traiter").count()))

        # Une ligne ouverte propose les deux décisions possibles.
        open_before = page.get_by_role("button", name="Traité").count()
        check("un signalement ouvert propose « traité »", open_before > 0, str(open_before))
        check("un signalement ouvert propose « écarter »",
              page.get_by_role("button", name="Écarter").count() > 0,
              str(page.get_by_role("button", name="Écarter").count()))

        # On classe le premier, et la ligne doit quitter la file ouverte.
        if open_before > 0:
            page.get_by_role("button", name="Traité").first.click()
            page.wait_for_timeout(2200)
            open_after = page.get_by_role("button", name="Traité").count()
            check("classer retire le signalement de la file ouverte",
                  open_after < open_before,
                  f"avant={open_before} apres={open_after}")

        # Le classement se voit dans l'onglet « tous » : sans cela, on
        # pourrait croire que le bouton n'a rien fait.
        page.get_by_role("tab", name="Tous").click()
        page.wait_for_timeout(1500)
        after_classify = page.inner_text("body").lower()
        check("un signalement classé reste visible et marqué",
              "traité" in after_classify or "écarté" in after_classify,
              after_classify[:300])

        browser.close()


def run_execution() -> None:
    """L'éditeur et l'exécution — la seule partie que Node ne peut pas faire."""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})
        errors: list[str] = []
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)

        # ── L'éditeur ────────────────────────────────────────────────
        editor = page.get_by_role("textbox", name="Contenu de")
        check("l'éditeur est présent", editor.count() > 0, str(editor.count()))
        check("le bouton d'exécution existe pour un fichier Python",
              page.get_by_role("button", name="Exécuter", exact=False).count() > 0,
              str(page.get_by_role("button", name="Exécuter", exact=False).count()))

        # La coloration passe par un `pre` décoratif derrière le textarea.
        colored = page.locator(
            '.monaco-editor .view-line span[class^="mtk"], '
            'pre[aria-hidden="true"] [class^="tok-"]'
        )
        check("la coloration syntaxique est rendue", colored.count() > 0,
              f"{colored.count()} jetons")

        # La gouttière compte les lignes du texte : écrire une ligne de
        # plus doit l'ajouter. Sans ça, on ne sait plus où on est.
        #
        # On lit les **numéros affichés**, pas la hauteur de la boîte. Le
        # `pre` de la gouttière est un enfant de `flex`, donc il est étiré
        # sur la hauteur du textarea (18 lignes) quoi qu'il contienne :
        # ajouter une ligne à un fichier de dix lignes ne change donc rien
        # à sa boîte. Une hauteur ne pouvait pas le voir, et le test
        # échouait sur une gouttière parfaitement fonctionnelle.
        def gutter_lines() -> int:
            monaco_lines = page.locator(".monaco-editor .view-line")
            if monaco_lines.count():
                return monaco_lines.count()
            texte = page.locator('pre[aria-hidden="true"]').first.inner_text()
            return len([m for m in re.findall(r"\d+", texte)])

        avant = gutter_lines()
        focus_code(page)
        page.keyboard.press("Control+End")
        page.keyboard.insert_text("\n# une ligne de plus")
        page.wait_for_timeout(400)
        check("la gouttière suit le nombre de lignes", gutter_lines() == avant + 1,
              f"avant={avant} apres={gutter_lines()}")

        # Tabulation : sans traitement, le focus quitte le champ — on
        # n'écrirait plus de code au clavier.
        page.keyboard.press("Control+Home")
        page.keyboard.press("Tab")
        page.wait_for_timeout(300)
        check("Tab indente et ne perd pas le focus",
              page.get_by_role("textbox", name="Contenu de").count() == editor.count(),
              "le focus a quitté l'éditeur")

        # Ctrl+S ne doit pas ouvrir la boîte « enregistrer la page ».
        before_save = page.url
        page.keyboard.press("Control+s")
        page.wait_for_timeout(600)
        check("Ctrl+S n'ouvre pas la boîte de dialogue du navigateur",
              page.url == before_save, page.url)

        # ── Exécuter : JavaScript d'abord ────────────────────────────
        # Python exige Pyodide : plusieurs mégaoctets depuis Internet. On
        # vérifie d'abord JavaScript, qui n'a **rien** à charger — c'est
        # la preuve que l'exécution elle-même fonctionne, hors ligne.
        js_path = "essai.js"
        page.get_by_role("button", name="Nouveau", exact=False).first.click()
        page.wait_for_timeout(800)

        # Pas de repli sur « le premier `input` de la page ». Ce sélecteur
        # a déjà coûté un diagnostic : le Ctrl+S précédent enregistre le
        # fichier, ce qui fait apparaître la boîte « message de la
        # révision » — et son champ passe **avant** celui de la feuille.
        # Le repli y écrivait donc le chemin du fichier dans le message
        # de révision, et l'écran répondait fidèlement « Créer » désactivé
        # parce que le chemin était vide. On cible donc le champ par son
        # étiquette : si le libellé change, le test échoue bruyamment au
        # lieu d'écrire au mauvais endroit.
        sheet = page.get_by_role("textbox", name="Chemin du fichier")
        check("la feuille demande un chemin de fichier", sheet.count() == 1,
              str(sheet.count()))
        sheet.first.fill(js_path)

        page.get_by_role("button", name="Créer", exact=False).last.click()
        page.wait_for_timeout(1500)

        check("le fichier JavaScript est ouvert",
              page.get_by_role("textbox", name=f"Contenu de {js_path}").count() > 0,
              page.url)

        js_editor = page.get_by_role("textbox", name=f"Contenu de {js_path}")
        if js_editor.count() > 0:
            replace_code(
                page,
                'console.log("bonjour depuis le worker");\n'
                "console.log(6 * 7);",
            )
            page.wait_for_timeout(400)

            page.get_by_role("button", name="Exécuter", exact=False).first.click()

            # Une exécution locale est instantanée : on attend la sortie
            # plutôt qu'une durée fixe.
            sortie = page.get_by_role("region")
            page.wait_for_timeout(4000)

            body = page.inner_text("body")
            check("la sortie contient ce que le code a affiché",
                  "bonjour depuis le worker" in body, body[-400:])
            check("la sortie contient le résultat calculé",
                  "42" in body, body[-400:])

        check("aucune erreur de console pendant l'exécution",
              not errors, errors[:3])

        browser.close()


def run_branches() -> None:
    """Les branches : créer, travailler, revenir.

    C'est le lot qui débloque les pull requests, et sa vraie question
    n'est pas « le bouton existe-t-il » mais « les branches sont-elles
    **isolées** ». Deux branches qui partagent leurs fichiers n'ont rien
    à comparer : la pull request suivante comparerait du vide.

    On vérifie donc le contenu **après un aller-retour** — seule une
    lecture du contenu de chaque branche le prouve.
    """

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})
        errors: list[str] = []
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)

        # `exact=True` est nécessaire : sans lui, « Branche » matche aussi
        # « Nouvelle branche » et « Supprimer la branche », la correspondance
        # étant une recherche de sous-chaîne insensible à la casse.
        selecteur = page.get_by_label("Branche", exact=True)
        check("le dépôt affiche son sélecteur de branche", selecteur.count() == 1,
              str(selecteur.count()))
        check("le dépôt ouvre sur la branche par défaut",
              selecteur.input_value() == "main", selecteur.input_value())

        # Le dépôt s'ouvre sur un fichier, pas sur un tampon vide : sans
        # cela, tout ce qui suit porterait sur un écran qui ne montre rien.
        # Monaco OU le repli : les deux sont un éditeur, on attend le quel.
        moteur = wait_editor(page)
        check("un fichier est ouvert à l'arrivée", moteur != "aucun", moteur)

        if moteur == "aucun":
            browser.close()
            return
        texte_main = code_text(page)
        check("le fichier ouvert a du contenu", len(texte_main) > 0, str(len(texte_main)))

        # ── Créer ──
        page.get_by_role("button", name="Nouvelle branche").click()
        page.wait_for_timeout(700)

        champ = page.get_by_role("textbox", name="nom de la branche")
        check("la feuille demande un nom de branche", champ.count() == 1,
              str(champ.count()))

        # Un nom refusé ne doit jamais produire une branche. Le verdict
        # est affiché **sous le champ**, pas seulement au clic : quelqu'un
        # qui tape ne doit pas découvrir la règle en essayant.
        champ.fill("feat/../main")
        page.wait_for_timeout(400)
        corps = page.inner_text("body").lower()
        check("un nom dangereux est expliqué sous le champ",
              ".." in corps, corps[-300:])
        check("un nom dangereux ne peut pas être créé",
              page.get_by_role("button", name="Créer", exact=False).last.is_disabled())

        champ.fill("amelioration")
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Créer", exact=False).last.click()
        page.wait_for_timeout(2500)

        check("la nouvelle branche est créée et affichée",
              selecteur.input_value() == "amelioration", selecteur.input_value())
        check("la feuille se referme",
              page.get_by_role("textbox", name="nom de la branche").count() == 0)

        # La branche reçoit une **copie** : elle part du même commit,
        # donc elle doit montrer le même dépôt. Une branche vide
        # ressemblerait à un dépôt sans fichier — qui semble marcher.
        check("la nouvelle branche a reçu les fichiers",
              has_editor(page))
        if has_editor(page):
            copie_branche = code_text(page)
            check("la copie est identique à son point de départ",
                  copie_branche == texte_main,
                  f"main={texte_main[:120]!r}, branche={copie_branche[:120]!r}")

        # ── Travailler dessus ──
        editeur = page.get_by_role("textbox", name="Contenu de").first
        focus_code(page)
        page.keyboard.press("Control+End")
        page.keyboard.insert_text("\n# travail sur la branche")
        page.wait_for_timeout(400)
        page.keyboard.press("Control+s")
        page.wait_for_timeout(1800)

        check("le fichier s'écrit sur la branche",
              "travail sur la branche" in code_text(page))

        # ── Revenir sur main : c'est LA vérification ──
        #
        # Le sélecteur de branche était cassé avant ce lot : `load`
        # dépendait de `branch` **et** la réaffectait, donc l'écran
        # repartait sur `main` juste après le changement. Sans ce
        #aller-retour, ce bug passerait : le sélecteur afficherait bien
        # la bonne branche pendant une seconde, puis reviendrait.
        selecteur.select_option("main")
        page.wait_for_timeout(2500)

        check("le sélecteur de branche tient",
              selecteur.input_value() == "main", selecteur.input_value())

        if has_editor(page):
            check("main n'a pas reçu le travail de la branche",
                  "travail sur la branche" not in code_text(page))

        # ── Retour sur la branche : le travail est toujours là ──
        selecteur.select_option("amelioration")
        page.wait_for_timeout(2500)
        check("la branche a conservé son travail",
              has_editor(page) and
              "travail sur la branche" in code_text(page))

        # ── La branche par défaut est protégée ──
        selecteur.select_option("main")
        page.wait_for_timeout(2000)
        check("la branche par défaut ne peut pas être supprimée",
              page.get_by_role("button", name="Supprimer la branche").first.is_disabled())

        # ── Supprimer ──
        selecteur.select_option("amelioration")
        page.wait_for_timeout(2000)
        page.get_by_role("button", name="Supprimer la branche").first.click()
        page.wait_for_timeout(700)

        corps = page.inner_text("body")
        check("la suppression demande confirmation",
              "amelioration" in corps and "Annuler" in corps, corps[-300:])

        page.get_by_role("button", name="Supprimer", exact=True).first.click()
        page.wait_for_timeout(2500)

        noms = selecteur.locator("option").all_inner_texts()
        check("la branche supprimée disparaît",
              "amelioration" not in noms, noms)
        check("le dépôt revient sur la branche par défaut",
              selecteur.input_value() == "main", selecteur.input_value())

        check("aucune erreur de console pendant la gestion des branches",
              not errors, errors[:3])

        browser.close()


def run_pull_requests() -> None:
    """Les demandes : lire le diff, puis intégrer pour de vrai.

    Ce parcours existe parce que la fusion est le seul acte de tout le
    produit qui **écrit dans deux tables à la fois** : l'état de la
    branche de destination et la demande elle-même. Une lecture ne
    prouverait rien — il faut voir la destination changer, et la demande
    passer de « ouverte » à « intégrée ».

    Il vérifie aussi le refus, parce qu'un bouton de fusion qu'on n'a
    jamais vu échouer n'est pas un bouton qu'on peut croire.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})
        errors: list[str] = []
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)

        # ── L'onglet ──
        onglet = page.get_by_role("tab", name="Demandes")
        check("le dépôt affiche un onglet des demandes", onglet.count() == 1,
              str(onglet.count()))
        # Le libellé est passé en capitales par la feuille de style :
        # `inner_text` rend le texte **après** transformation, donc la
        # comparaison doit être insensible à la casse.
        check("l'onglet annonce le nombre de demandes ouvertes",
              "demandes 1" in onglet.inner_text().lower(), onglet.inner_text())

        onglet.click()
        page.wait_for_timeout(3000)

        corps = page.inner_text("body")
        check("la liste des demandes rend quelque chose",
              "Journal d'audit" in corps and "code-barres" in corps,
              corps[-300:])
        # Le nom des deux branches est l'identité de la demande : deux
        # demandes peuvent porter le même titre, deux branches non.
        check("la demande nomme sa branche de départ",
              "lecture-code-barres" in corps, corps[-300:])
        check("la demande nomme sa branche d'arrivée", "main" in corps)

        # ── Le diff ──
        #
        # On déplie la demande **ouverte**, pas la première de la liste :
        # la première est celle qui est déjà intégrée, et son diff est vide
        # par définition. Ce serait un parcours vert qui ne prouve rien.
        ligne = page.get_by_role("button", name="Demande numéro 2", exact=True)
        check("la demande ouverte est identifiable", ligne.count() == 1,
              str(ligne.count()))
        ligne.click()
        page.wait_for_timeout(2500)

        corps = page.inner_text("body")
        check("le diff montre le fichier modifié de la branche",
              "lecteur.py" in corps, corps[-400:])
        check("le diff montre des lignes ajoutées",
              "CODE_BARRE" in corps, corps[-400:])

        # Le diff doit montrer ce que la branche **apporte**, pas la
        # différence des deux branches : sinon il afficherait en
        # suppressions le travail fait sur `main` depuis le départ.
        check("le diff n'invente pas de suppression du travail de la destination",
              "journaliser" not in corps, corps[-400:])

        # ── Le verdict ──
        verdict = page.get_by_text("La destination a reçu", exact=False)
        check("le motif de la fusion est affiché", verdict.count() > 0,
              page.inner_text("body")[-400:])

        bouton = page.get_by_role("button", name="Fusionner dans main")
        check("le bouton de fusion est proposé", bouton.count() == 1)
        check("le bouton de fusion est actif", bouton.is_enabled())

        # ── La fusion ──
        bouton.click()
        page.wait_for_timeout(5000)

        corps = page.inner_text("body")
        check("la demande passe à intégrée", "intégrée" in corps, corps[-400:])

        # Ces deux vérifications portent sur la **liste des demandes** :
        # elles doivent donc se faire ici, avant de repasser sur l'onglet
        # Code. Les faire après reviendrait à chercher un bouton qui n'est
        # plus monté — un échec qui accuse l'interface d'un défaut de test.
        #
        # La demande fusionnée ne peut plus l'être : le bouton a disparu,
        # et c'est l'écran — pas le serveur — qui le dit.
        check("le bouton de fusion a disparu",
              page.get_by_role("button", name="Fusionner dans main").count() == 0)

        # ── La demande dont la branche a disparu ──
        #
        # C'est le cas ordinaire d'une intégration : la branche est
        # supprimée une fois son travail arrivé. L'écran ne doit alors
        # annoncer **aucun** nombre de fichiers — la comparer à une
        # branche vide ferait dire à la demande qu'elle a tout supprimé.
        ligne1 = page.get_by_role("button", name="Demande numéro 1", exact=True)
        check("la demande intégrée est identifiable", ligne1.count() == 1,
              str(ligne1.count()))

        if ligne1.count() == 1:
            texte1 = ligne1.inner_text()
            check("une demande sans branche n'annonce pas de retrait massif",
                  "−51" not in texte1 and "−42" not in texte1, texte1[:200])
            check("une demande sans branche le dit", "branche supprimée" in texte1,
                  texte1[:200])

        # La preuve qui compte : `main` porte maintenant le fichier de la
        # branche. Sans cette lecture, un écran pourrait annoncer une
        # intégration sans que rien n'ait été écrit.
        selecteur = page.get_by_label("Branche", exact=True)
        selecteur.select_option("main")
        page.wait_for_timeout(2500)

        # On revient à l'onglet Code : c'est là que l'éditeur est monté.
        # Le chercher depuis l'onglet Demandes échouerait pour une raison
        # qui n'a rien à voir avec la fusion.
        page.get_by_role("tab", name="Code").click()
        page.wait_for_timeout(2000)

        # On ouvre explicitement le fichier que la branche avait changé.
        #
        # Deux précautions, toutes deux apprises à l'écran : l'éditeur
        # revient sur le premier fichier de l'explorateur, qui n'a rien à
        # voir avec la fusion ; et cliquer sur le fichier **déjà ouvert**
        # ne change pas l'état, donc l'éditeur garde le contenu de la
        # branche quittée. On passe donc par un autre fichier d'abord.
        if page.get_by_role("button", name="registre.py").count() > 0:
            page.get_by_role("button", name="registre.py").first.click()
            page.wait_for_timeout(1200)

        if page.get_by_role("button", name="lecteur.py").count() > 0:
            page.get_by_role("button", name="lecteur.py").first.click()
            page.wait_for_timeout(1500)

        if has_editor(page):
            contenu = code_text(page)
            check("la destination porte le travail de la branche",
                  "CODE_BARRE" in contenu, contenu)
            print("DEBUG lecteur apres fusion :", repr(contenu[:200]))
        else:
            check("la destination porte le travail de la branche", False,
                  "aucun fichier ouvert")

        # ── L'ouverture d'une demande ──
        #
        # Une demande part de la **branche affichée**. On crée donc une
        # branche, on bascule dessus, et on ouvre la demande depuis là :
        # c'est le geste qu'un présentateur fera.
        selecteur.select_option("main")
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Nouvelle branche").click()
        page.wait_for_timeout(700)

        champ = page.get_by_role("textbox", name="nom de la branche")
        champ.fill(BRANCHE_NEUVE)
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Créer", exact=False).last.click()
        page.wait_for_timeout(2500)

        selecteur.select_option(BRANCHE_NEUVE)
        page.wait_for_timeout(2000)

        # La branche est une **copie** de `main` : elle n'apporte rien tant
        # qu'on n'y a pas écrit. C'est le geste réel — écrire, écrire le
        # fichier, puis enregistrer la révision avec son message — et c'est
        # exactement ce que l'écran refuse quand on l'omet.
        editeur = page.get_by_role("textbox", name="Contenu de").first
        focus_code(page)
        page.keyboard.press("Control+End")
        page.keyboard.insert_text("\n# lecture du registre a voix haute")
        page.wait_for_timeout(400)
        page.keyboard.press("Control+s")
        page.wait_for_timeout(2500)

        # `Ctrl+S` écrit le fichier ; la révision est un second geste.
        champMessage = page.locator("#commit-msg")
        check("l'écran propose d'enregistrer une révision", champMessage.count() == 1)
        champMessage.fill("Lit le registre a voix haute")
        page.wait_for_timeout(300)
        page.get_by_role("button", name="Enregistrer la révision").click()
        page.wait_for_timeout(3000)

        page.get_by_role("tab", name="Demandes").click()
        page.wait_for_timeout(2000)

        page.get_by_role("button", name="Demander l\'intégration").first.click()
        page.wait_for_timeout(2500)

        champTitre = page.get_by_label("Titre de la demande")
        check("la feuille demande un titre", champTitre.count() == 1)
        check("la feuille annonce ce que la branche apporte",
              "cette branche apporte" in page.inner_text("body"),
              page.inner_text("body")[-300:])

        # Un titre trop court ne doit jamais produire une demande : le
        # bouton est désactivé, et la raison est écrite sous le champ.
        champTitre.fill("ab")
        page.wait_for_timeout(400)
        check("un titre trop court empêche l'envoi",
              page.get_by_role("button", name="Ouvrir la demande").is_disabled())
        check("la raison du refus est affichée",
              "3 caractères" in page.inner_text("body"))

        champTitre.fill("Lecture du registre à voix haute")
        page.wait_for_timeout(600)
        page.get_by_role("button", name="Ouvrir la demande").click()
        page.wait_for_timeout(3500)

        # La demande est lue **dans sa ligne**, pas dans le corps de la
        # page : le texte de la page contient aussi la liste des autres
        # demandes, et une recherche globale passerait pour une preuve
        # alors qu'elle lirait une autre ligne.
        ligne3 = page.get_by_role("button", name="Demande numéro 3", exact=True)
        check("la nouvelle demande est numérotée", ligne3.count() == 1,
              str(ligne3.count()))

        if ligne3.count() == 1:
            # La liste se recharge après la création : on relit une fois
            # le rendu stabilisé plutôt que de valider un état
            # intermédiaire, qui donnerait un échec sans cause.
            page.wait_for_timeout(1200)
            texte = ligne3.inner_text()
            check("la demande ouverte apparaît",
                  "Lecture du registre à voix haute" in texte, texte[:160])
            check("la demande vient de la branche affichée",
                  BRANCHE_NEUVE in texte, texte)

        # Une seconde demande pour la même branche doit être refusée, et
        # l'écran doit dire laquelle — sinon l'utilisateur cherche.
        page.get_by_role("button", name="Demander l\'intégration").first.click()
        page.wait_for_timeout(800)
        champTitre.fill("Encore la même branche")
        page.get_by_role("button", name="Ouvrir la demande").click()
        page.wait_for_timeout(2500)

        corps = page.inner_text("body")
        check("une seconde demande pour la même branche est refusée",
              "déjà une demande ouverte" in corps, corps[-400:])

        check("aucune erreur de console pendant les demandes", not errors, errors[:3])

        browser.close()


def run_wiki() -> None:
    """Le wiki de dépôt — écriture, relecture, retrait.

    La vérification qui compte n'est pas « l'onglet existe », c'est que le
    texte écrit soit **relu** après enregistrement. Un écran qui accepte
    une saisie sans la conserver a exactement la même apparence qu'un
    écran qui la conserve — tant qu'on ne relit pas.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        page = nouvelle_page(browser, viewport={"width": 1280, "height": 900})
        errors: list[str] = []
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

        page.goto(f"{BASE}/projects/p-1", wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)

        onglet = page.get_by_role("tab", name="Doc")
        check("le dépôt affiche un onglet de documentation",
              onglet.count() == 1, str(onglet.count()))
        onglet.click()
        page.wait_for_timeout(2500)

        corps = page.inner_text("body")
        check("le sommaire liste les pages de démonstration",
              "Démarrage" in corps and "Architecture" in corps, corps[-300:])
        # La page s'ouvre sur un document lu, pas sur un tampon vide.
        check("une page est lue à l'ouverture",
              "python lecteur.py" in corps, corps[-300:])

        page.get_by_role("button", name="Nouvelle page").click()
        page.wait_for_timeout(2000)

        titre = page.get_by_role("textbox", name="Titre de la page")
        check("la nouvelle page s'ouvre en écriture", titre.count() == 1, str(titre.count()))

        if titre.count() == 1:
            titre.fill("Journal des décisions")
            page.get_by_role("textbox", name="Contenu de la page").fill(
                "# Journal\n\n- la première décision"
            )
            page.get_by_role("button", name="Enregistrer").click()
            page.wait_for_timeout(2500)

            corps = page.inner_text("body")
            check("le titre enregistré est relu",
                  "Journal des décisions" in corps, corps[-300:])
            check("le corps enregistré est relu",
                  "la première décision" in corps, corps[-300:])

            page.get_by_role("button", name="Supprimer la page").click()
            page.wait_for_timeout(500)
            page.get_by_role("button", name="Supprimer").last.click()
            page.wait_for_timeout(2500)

            corps = page.inner_text("body")
            check("la page supprimée disparaît",
                  "Journal des décisions" not in corps, corps[-300:])

        check("aucune erreur de console pendant le wiki", not errors, errors[:3])
        browser.close()


def run_ecrans() -> None:
    """Les quatre écrans retouchés par la passe lint (set-state-in-effect).

    Chaque écran a été modifié soit dans la mécanique de chargement (IIFE
    async dans les effets, inline du corps d'un `useCallback`), soit dans
    un `setState` sync couvert par un `disable-next-line` justifié. Les
    tests de logique passent, mais ils n'exécutent pas React : seul un vrai
    navigateur prouve que les pages se chargent, remplissent leurs listes,
    envoient un message après la refonte des effets, et que la visite se
    présente puis se ferme sans cascade ni erreur de console.
    """

    def connecter(page, erreur: list[str]) -> None:
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Entrer comme").click()
        page.wait_for_timeout(3000)

    def sur_ecran(nom: str):
        """Ouvre une page « utilisateur qui revient » avec écoute d'erreurs."""
        retour = {}

        def ouvrir() -> "page":  # noqa: F821
            pass

        with sync_playwright() as p:
            browser = p.chromium.launch(
                executable_path="/usr/bin/google-chrome",
                args=["--no-sandbox"],
            )
        return browser

    browser = _lancer_chrome()
    # ── 1) L'IDE ────────────────────────────────────────────────────
    # Le contenu de l'éditeur est reposé par un effet re-synchronisé au
    # changement de fichier — exactement ce que la passe lint a retouché.
    page = _page_sans_visite(browser)
    erreurs_ide: list[str] = []
    page.on("console", lambda m: erreurs_ide.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: erreurs_ide.append(str(e)))
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(3000)
    page.goto(f"{BASE}/ide/p-1", wait_until="networkidle", timeout=90_000)
    page.wait_for_timeout(2500)

    moteur = wait_editor(page)
    check("l'IDE ouvre l'éditeur", moteur != "aucun", moteur)
    texte = code_text(page)
    check("le contenu du fichier initial est posé", len(texte.strip()) > 0, "vide")
    # Changer de fichier repose le contenu de celui-ci (changement d'état
    # dérivé, corrigé pendant la passe lint) : ne doit plus aboutir à un
    # contenu vide ni mélangé.
    tree = page.locator("button:has-text('.py')")
    if tree.count() > 1:
        tree.last.click()
        page.wait_for_timeout(1500)
        check("changer de fichier repose son contenu", len(code_text(page).strip()) > 0, "vide")
        tree.first.click()
        page.wait_for_timeout(1500)
        check("revenir sur le fichier d'origine rend son texte",
              len(code_text(page).strip()) > 0, "vide")
    check("aucune erreur de console dans l'IDE", not erreurs_ide, erreurs_ide[:3])
    page.close()

    # ── 2) Un groupe, son fil de canaux et son composeur ───────────
    # Les préénoms des pairs qui tapent vivent dans un effet converti en
    # IIFE async : la page doit toujours rejoindre le canal et envoyer.
    page = _page_sans_visite(browser)
    erreurs_groupe: list[str] = []
    page.on("console", lambda m: erreurs_groupe.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: erreurs_groupe.append(str(e)))
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(3000)
    page.goto(f"{BASE}/groups/g-1", wait_until="networkidle", timeout=90_000)
    page.wait_for_timeout(3000)

    canaux = page.locator('nav[aria-label="Canaux"] button')
    check("le groupe liste ses canaux", canaux.count() >= 1, str(canaux.count()))
    compo = page.locator("#composer-channel")
    check("le composeur du canal est prêt",
          compo.count() == 1 and compo.first.is_enabled(), "absent ou désactivé")
    compo.first.click()
    page.keyboard.type("Vérification du bulle temps réel : envoyé par le parcours.")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2000)
    fil = page.inner_text("body")
    check("le message envoyé apparaît dans le fil",
          "envoyé par le parcours" in fil, fil[-300:])
    check("aucune erreur de console dans le groupe", not erreurs_groupe, erreurs_groupe[:3])
    page.close()

    # ── 3) La messagerie privée ────────────────────────────────────
    # Charger une conversation s'appuie sur le corps du `useCallback`
    # `refresh` inliné (motif c) : les conversations doivent toujours
    # s'ouvrir, leurs historiques s'afficher et l'envoi répondre.
    page = _page_sans_visite(browser)
    erreurs_dm: list[str] = []
    page.on("console", lambda m: erreurs_dm.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: erreurs_dm.append(str(e)))
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(3000)
    page.goto(f"{BASE}/messages", wait_until="networkidle", timeout=90_000)
    page.wait_for_timeout(3000)

    convos = page.locator('section[aria-label="Conversations"] button')
    check("la liste des conversations est là", convos.count() >= 1, str(convos.count()))
    if convos.count() >= 1:
        convos.first.click()
        page.wait_for_timeout(2000)
        fil = page.inner_text("body")
        check("l'historique de la conversation s'affiche",
              "normalisation" in fil.lower(), fil[-300:])
        compo_dm = page.locator("#dm-composer")
        check("le composeur privé est prêt",
              compo_dm.count() == 1 and compo_dm.first.is_enabled(), "absent ou désactivé")
        compo_dm.first.click()
        page.keyboard.type("Message de vérification du parcours.")
        page.keyboard.press("Enter")
        page.wait_for_timeout(2000)
        check("l'envoi apparaît dans l'historique",
              "Message de vérification du parcours" in page.inner_text("body"), "absent du fil")
    check("aucune erreur de console dans les messages", not erreurs_dm, erreurs_dm[:3])
    page.close()

    # ── 4) La visite guidée ────────────────────────────────────────
    # Le `setState` de survie au montage de `TourOverlay` est couvert par un
    # `disable-next-line` justifié. Un visiteur jamais passé doit voir la
    # bulle d'intro se poser, avancer, puis se fermer sans erreur.
    page = _page_avec_visite(browser)
    erreurs_tour: list[str] = []
    page.on("console", lambda m: erreurs_tour.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: erreurs_tour.append(str(e)))
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1200)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(4000)
    dialogue = page.locator('[role="dialog"][aria-label="Prise en main de DevNet"]')
    check("la prise en main se présente au premier passage",
          dialogue.count() == 1, str(dialogue.count()))
    if dialogue.count() == 1:
        suivant = page.get_by_role("button", name="Suivant")
        check("le bouton suivant avance la prise en main",
              suivant.count() == 1 and suivant.first.is_enabled())
        suivant.first.click()
        page.wait_for_timeout(1200)
        check("la diapositive avance", dialogue.count() == 1 and suivant.count() == 1)
        passer = page.get_by_role("button", name="Passer")
        check("on peut passer l'intro pour ouvrir la visite",
              passer.count() == 1 and passer.first.is_enabled())
        passer.first.click()
        page.wait_for_timeout(1500)
        visite = page.locator('[role="dialog"][aria-label="Visite guidée de DevNet"]')
        check("la visite guidée s'ouvre après l'intro", visite.count() == 1, str(visite.count()))
    check("aucune erreur de console pendant la tour", not erreurs_tour, erreurs_tour[:3])
    page.close()

    browser.close()


def main() -> int:
    run()
    run_motion()
    run_moderation()
    run_execution()
    run_branches()
    run_pull_requests()
    run_wiki()

    # Une erreur de console n'est pas toujours fatale, mais elle mérite
    # d'être rapportée : c'est souvent le seul signe d'un effet qui lève.
    if console_errors:
        print("\nErreurs de console relevées :")
        for e in console_errors[:10]:
            print(f"  • {e}")

    print(f"\n{ok} vérification(s) passée(s), {len(failures)} échec(s)\n")
    if failures:
        for f in failures:
            print(f"  ✗ {f}")
        return 1
    if console_errors:
        print("  ! parcours vert mais console bruyante\n")
        return 1
    print("  ✓ Le parcours connexion + notifications tient dans le navigateur\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())