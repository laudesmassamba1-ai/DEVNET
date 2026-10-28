"""Parcours mobile — 390 × 844, ce que `parcours-navigateur.py` ne voit pas.

Exécuter avec :  python3 scripts/parcours-mobile.py

Pourquoi ce fichier existe à part
--------------------------------

Le parcours navigateur tourne en 1280 × 900. Un écran peut donc casser
sur téléphone sans qu'aucune vérification ne le voie : c'est le manque
que la section 21 du MEMO a constaté et laissé en l'air. Ce script le
referme, et il ne se contente pas de regarder — il **échoue**.

Ce qui est un échec, et ce qui ne l'est pas
-------------------------------------------

Trois règles, de la plus dure à la plus souple.

1. **Aucun débordement horizontal.** C'est la faute la plus visible de
   toutes : un écran que l'on fait défiler de côté trahit immédiatement
   qu'il n'a pas été pensé pour cette largeur. Mesuré après avoir
   descendu jusqu'en bas de la page, sinon un contenu chargé en
   différé passerait inaperçu.

2. **Navigation à 44 px.** La barre basse et la barre de titre sont la
   navigation : on les utilise à chaque écran. Le jeton `--h-tap` existe
   pour ça et il est « règle dure », donc un élément de **coque** mesuré
   en dessous échoue. Ces cibles sont en outre **actionnables** : le
   script les presse avec un vrai clic tactile, parce qu'un bouton de
   44 px qu'on ne peut pas atteindre n'est pas de 44 px. La coque se
   distingue d'un `<nav>` de contenu — l'arborescence du dépôt est
   elle aussi un `nav` — sinon le test ne saurait plus distinguer une
   faute d'une décision.

3. **Un plancher de 24 px, puis un relevé.** Les contrôles à l'intérieur
   d'une carte — mentions, hashtags, boutons de partage — restent sous
   44 px : c'est une décision de DA, consignée en section 21 avec ses
   chiffres, et les changer sans réflexion serait aussi grave que de les
   laisser. Ce script ne les corrige pas et ne les approuve pas : il
   **compte** ceux qui sont sous la règle, et compare au relevé de la
   section 21. Le plancher de 24 px est en revanche surveillé comme un
   seuil dur, et ce n'est pas un chiffre choisi ici : c'est le critère
   2.5.8 « Taille cible (minimum) » du WCAG 2.2 niveau AA. Sous 24 px,
   la cible cesse d'être atteignable au pouce, et il n'y a plus d'opinion
   qui tienne — la section 21 en avait d'ailleurs laissé passer un
   bouton de 22 px, que ce test a fait remonter à sa création.
"""

import re
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

# 390 × 844 : la taille de référence d'un téléphone courant. Pas 375 :
# 390 est le format le plus répandu aujourd'hui, et c'est le plus large —
# donc celui où un débordement horizontal apparaît le moins. Tester au
# plus étroit serait plus sévère, mais 375 n'est plus représentatif.
FENETRE = {"width": 390, "height": 844}

ROUTES = [
    "/",
    "/feed",
    "/notifications",
    "/messages",
    "/groups",
    "/search",
    "/projects",
    "/projects/p-1",
    "/profile",
    "/u/koffi",
    "/moderation",
    "/login",
]

# Sous 24 px : seuil dur, échec. Entre 24 et 44 px : relevé, comparé au
# nombre de la section 21 (mesuré, non corrigé). Les clés sont les
# routes où le décompte a été relevé sur le jeu de démonstration courant ;
# une route absente est simplement ignorée, elle n'est pas un échec. Le
# décompte dépend des données affichées, donc il bouge dès qu'une
# publication s'ajoute au jeu : c'est pourquoi seule une **hausse** est
# signalée, et pourquoi un nombre plus petit est compté comme une
# amélioration silencieuse plutôt que comme une erreur de mesure.
PLANCHER = 24
RELEVE = {
    "/": 93,
    "/feed": 93,
    "/u/koffi": 31,
    "/notifications": 4,
    # 8 depuis l'ajout du panneau des demandes : une cible de plus
    # dans la carte, mesurée et laissée pour la même raison qu'en
    # section 21 (densité de carte = décision de DA).
    "/projects/p-1": 8,
    "/profile": 6,
}

# Mesure de débordement : on compare `scrollWidth` à la largeur utile, et
# on **nomme** les coupables. Une largeur de document plus grande que la
# fenêtre peut venir d'une barre de défilement verticale, d'où la marge
# de 1 px.
JS_DEBORDEMENT = """
() => {
  const largeur = document.documentElement.clientWidth;
  const coupables = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > largeur + 1.5 || r.left < -1.5) {
      coupables.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 48),
      });
    }
  }
  return {
    largeur,
    document: document.documentElement.scrollWidth,
    coupables: coupables.slice(0, 4),
  };
}
"""

# Mesure des cibles : hauteur en pixels et libellé. Le libellé vient de
# quatre endroits, dans cet ordre — le texte visible d'abord, parce que
# c'est ce que lirait une personne dans un compte rendu.
JS_CIBLES = """
() => {
  const cibles = [];
  for (const el of document.querySelectorAll('button, a, input, select, textarea, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') continue;
    cibles.push({
      tag: el.tagName.toLowerCase(),
      h: Math.round(r.height),
      nom: (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 30),
      // « Coque » : la barre de titre et la barre basse seulement. Un
      // `<nav>` de contenu — l'arborescence du dépôt, par exemple — en
      // est un aussi, et ses lignes sont sous la règle pour une raison
      // §21, decidée en connaissance de cause. Confondre les deux
      // rendrait ce test incapable de distinguer une faute d'un choix.
      chrome: !!el.closest('header') || !!el.closest('nav.fixed'),
    });
  }
  return cibles;
}
"""

ok = 0
failures: list[str] = []
releve_observe: list[str] = []
console_errors: list[str] = []


def check(nom: str, condition: bool, detail: str = "") -> None:
    global ok
    if condition:
        ok += 1
    else:
        failures.append(f"{nom}{f' → {detail}' if detail else ''}")


def neutraliser_overlay(page) -> None:
    """Retirer le portail de développement de Next.

    En développement, Next monte un `<nextjs-portal>` — l'indicateur de
    son outillage — qui se pose **par-dessus** la barre basse et capte les
    clics : en 390 px il occupe précisément les 60 px où sont les onglets.
    Ce n'est pas un défaut du produit, il n'existe pas en production, mais
    il rend le parcours de navigation impossible : il faut donc le retirer,
    et le dire, sinon la correction ressemble à un bug dans l'application.

    Il est retiré à chaque ajout de nœud, car il revient à chaque
    navigation.
    """
    page.add_init_script(
        """
        (() => {
          const retirer = () => {
            for (const n of document.querySelectorAll('nextjs-portal')) n.remove();
          };
          const observer = new MutationObserver(retirer);
          document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.documentElement, { childList: true, subtree: true });
            retirer();
          });
        })();
        """
    )


def desactiver_visite(page) -> None:
    """Poser le drapeau « visite guidée déjà vue ».

    La prise en main se lance d'elle-même à la première connexion. Ce
    parcours teste le produit, pas la visite : on se présente donc comme un
    utilisateur qui revient. Le drapeau est posé avant tout chargement,
    sans quoi la bulle recouvrirait les cibles que l'on mesure.
    """
    page.add_init_script(
        "try { window.localStorage.setItem('devnet.tour.v1', 'done'); } catch {}"
    )


def connecter(page) -> None:
    """Connexion par le bouton de démonstration.

    On passe par le même chemin qu'un visiteur : sans session, toutes les
    pages protégées redirigent vers `/login` et le script ne mesurerait que
    l'écran de connexion — c'est-à-dire rien.
    """
    page.goto(f"{BASE}/login", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Entrer comme").click()
    page.wait_for_timeout(3000)


def mesurer_routes(page) -> None:
    """Parcourir chaque route : rendu, débordement, cibles."""
    global ok
    for route in ROUTES:
        # L'IDE charge Monaco depuis un CDN ; attendre l'inactivité réseau
        # peut expirer même si la page est rendue et utilisable.
        wait_until = "domcontentloaded" if route.startswith("/projects/") else "networkidle"
        page.goto(f"{BASE}{route}", wait_until=wait_until)
        page.wait_for_timeout(2000)

        corps = page.inner_text("body")
        check(f"{route} rend du texte", len(corps) > 60, f"{len(corps)} caractères")

        # On descend jusqu'en bas avant de mesurer : les cartes du fil se
        # montent en différé, et un débordement en pied de page ne se voit
        # que lorsque le pied existe.
        page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(700)

        debordement = page.evaluate(JS_DEBORDEMENT)
        if debordement["document"] > debordement["largeur"] + 1:
            coupables = ", ".join(f"{c['tag']}.{c['cls']}" for c in debordement["coupables"])
            check(
                f"{route} ne déborde pas horizontalement",
                False,
                f"{debordement['document']} px pour {debordement['largeur']} px — {coupables}",
            )
        else:
            check(f"{route} ne déborde pas horizontalement", True)

        cibles = page.evaluate(JS_CIBLES)
        sous_regle = [c for c in cibles if c["h"] < 44]
        trop_petites = [c for c in sous_regle if c["h"] < PLANCHER]
        navigation_petite = [c for c in sous_regle if c["chrome"]]

        check(
            f"{route} n'a aucune cible sous {PLANCHER} px",
            not trop_petites,
            ", ".join(f"{c['tag']} {c['h']}px « {c['nom']} »" for c in trop_petites[:3]),
        )
        check(
            f"{route} a une navigation à 44 px",
            not navigation_petite,
            ", ".join(f"{c['tag']} {c['h']}px « {c['nom']} »" for c in navigation_petite[:3]),
        )

        # Le relevé : nombre de cibles sous la règle, par route. Il ne
        # fait pas échouer le script — il rend visible une **hausse**,
        # c'est-à-dire une nouvelle cible hors règle qui s'est glissée
        # dans une carte.
        if route in RELEVE:
            nombre = len(sous_regle)
            attendu = RELEVE[route]
            if nombre > attendu:
                releve_observe.append(
                    f"{route} : {nombre} cibles sous 44 px, relevé {attendu} (+{nombre - attendu})"
                )
            else:
                ok += 1


def mesurer_navigation(page) -> None:
    """La barre basse est le propre du mobile : elle doit exister et agir.

    Un `display: none` oublié, ou un lien qui pointe vers la mauvaise
    route, passe tous les tests de largeur. Il faut donc **cliquer**.
    """
    page.goto(f"{BASE}/feed", wait_until="networkidle")
    page.wait_for_timeout(2000)

    barre = page.locator("nav").first
    check("la barre basse est affichée sur téléphone", barre.is_visible())

    # La barre de titre du téléphone porte la marque quand l'écran n'a
    # pas de titre (le fil n'en a pas, le dépôt en a un) : c'est le seul
    # repère d'identité sur la moitié des écrans. La vérification est
    # faite **ici**, sur le fil, et non après la boucle : après la boucle
    # on se trouve sur le profil, qui a un titre — le test passerait ou
    # échouerait pour la mauvaise raison.
    check(
        "la barre de titre montre la marque sur le fil",
        "DEVNET" in page.inner_text("header").upper(),
        page.inner_text("header")[:80],
    )

    for libelle, attendu in (("Fil", "/feed"), ("Groupes", "/groups"), ("Profil", "/profile")):
        lien = barre.get_by_role("link", name=libelle, exact=True)
        check(f"la barre basse propose « {libelle} »", lien.count() == 1)
        if lien.count() == 0:
            continue
        boite = lien.bounding_box()
        check(
            f"« {libelle} » a une cible de 44 px",
            boite is not None and boite["height"] >= 44,
            f"{boite['height'] if boite else 0:.0f} px",
        )
        lien.click()
        page.wait_for_timeout(1800)
        check(f"« {libelle} » mène à {attendu}", page.url.endswith(attendu), page.url)

    # La cloche est le seul accès aux notifications sur téléphone : la
    # barre basse ne les propose pas, c'est un choix assumé. Il faut donc
    # qu'elle soit là, et qu'elle marche.
    page.goto(f"{BASE}/feed", wait_until="networkidle")
    page.wait_for_timeout(2000)
    cloche = page.locator("header button[aria-label^='Notifications']")
    check("la cloche est présente dans la barre de titre", cloche.count() == 1)
    if cloche.count() == 1:
        boite = cloche.bounding_box()
        check(
            "la cloche a une cible de 44 px",
            boite is not None and boite["height"] >= 44,
            f"{boite['height'] if boite else 0:.0f} px",
        )
        cloche.click()
        page.wait_for_timeout(1800)
        check("la cloche mène au centre de notifications",
              page.url.endswith("/notifications"), page.url)


def mesurer_depot(page) -> None:
    """Le dépôt sur téléphone : là où tout a été corrigé en 1280 px.

    Les onglets et le sélecteur de branche ont été remis à 44 px parce
    qu'ils étaient à 12 et 16 px. Rien ne garantissait que la correction
    tenait à cette largeur — d'où la mesure ici, et non une copie du
    parcours bureau.
    """
    page.goto(f"{BASE}/projects/p-1", wait_until="domcontentloaded")
    page.wait_for_timeout(2500)

    onglets = page.locator('[role="tab"], button').filter(has_text=re.compile(r"^(Code|Issues)"))
    for i in range(onglets.count()):
        boite = onglets.nth(i).bounding_box()
        nom = (onglets.nth(i).inner_text() or "").strip()
        if not nom or not boite:
            continue
        check(
            f"l'onglet « {nom} » a une cible de 44 px",
            boite["height"] >= 44,
            f"{boite['height']:.0f} px",
        )

    selecteur = page.get_by_label("Branche", exact=True)
    check("le dépôt affiche son sélecteur de branche", selecteur.count() == 1)
    if selecteur.count() == 1:
        boite = selecteur.bounding_box()
        check(
            "le sélecteur de branche a une cible de 44 px",
            boite is not None and boite["height"] >= 44,
            f"{boite['height'] if boite else 0:.0f} px",
        )


def main() -> int:
    with sync_playwright() as p:
        navigateur = p.chromium.launch(
            executable_path="/usr/bin/google-chrome",
            args=["--no-sandbox"],
        )
        # `is_mobile` et `has_touch` changent le rendu de la page : sans
        # eux, Chrome calcule des points d'arrêt différents et les
        # cibles se mesurent sur une mise en page de bureau.
        contexte = navigateur.new_context(
            viewport=FENETRE,
            is_mobile=True,
            has_touch=True,
            device_scale_factor=3,
        )
        page = contexte.new_page()
        neutraliser_overlay(page)
        desactiver_visite(page)
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        connecter(page)
        mesurer_routes(page)
        mesurer_navigation(page)
        mesurer_depot(page)

        check("aucune erreur de console sur l'ensemble des écrans",
              not console_errors, "; ".join(console_errors[:3]))

        navigateur.close()

    if releve_observe:
        print("\nCibles sous 44 px — en hausse par rapport au relevé de la section 21 :")
        for ligne in releve_observe:
            print(f"  • {ligne}")

    if console_errors:
        print("\nErreurs de console relevées :")
        for e in console_errors[:10]:
            print(f"  • {e}")

    print(f"\n{ok} vérification(s) passée(s), {len(failures)} échec(s)\n")
    for f in failures:
        print(f"  ✗ {f}")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())