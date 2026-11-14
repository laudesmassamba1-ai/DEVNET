import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Aide — DevNet",
  description: "Questions fréquentes et contacts pour utiliser DevNet.",
};

const FAQ: { theme: string; items: { q: string; a: string }[] }[] = [
  {
    theme: "Compte et connexion",
    items: [
      {
        q: "Comment créer un compte ?",
        a: "Depuis « Créer un compte », choisis étudiant ou professionnel, remplis tes informations puis ton profil technique. Un compte étudiant se crée en quelques secondes ; le compte professionnel donne accès aux capacités recruteur (badge vérifié, visibilité, messages entrants).",
      },
      {
        q: "J’ai oublié mon mot de passe.",
        a: "Depuis l’écran de connexion, clique sur « Mot de passe oublié ? », saisis ton email, puis suis le lien reçu pour choisir un nouveau mot de passe.",
      },
      {
        q: "Puis-je changer mon type de compte ?",
        a: "Un étudiant qui devient professionnel conserve ses publications, ses groupes et sa réputation. Le changement se fait depuis les paramètres du compte.",
      },
    ],
  },
  {
    theme: "Installer l’application (PWA)",
    items: [
      {
        q: "Comment installer DevNet sur Android ?",
        a: "Ouvre DevNet dans Chrome, puis menu ⋮ en haut à droite → « Installer l’application » (ou « Ajouter à l’écran d’accueil »). Une invite apparaît aussi dans l’app elle-même : appuie sur « Installer ». L’icône rejoint le tiroir d’applications et DevNet s’ouvre alors en plein écran, sans barre d’adresse.",
      },
      {
        q: "Comment installer DevNet sur iPhone ou iPad ?",
        a: "Safari ne connaît pas de bouton « Installer » : ouvre DevNet dans Safari, appuie sur Partager (le carré avec une flèche), puis « Sur l’écran d’accueil » et « Ajouter ». L’application s’ouvre ensuite en plein écran. Depuis Chrome ou Firefox sur iOS, passe d’abord par Safari : seul lui installe une application web.",
      },
      {
        q: "Pourquoi l’app installée n’a-t-elle pas de barre d’adresse ?",
        a: "C’est le mode autonome du manifeste : la fenêtre est celle de l’application, pas celle du navigateur. L’encoche et la barre d’accueil de l’iPhone sont prises en compte (marges de sécurité), et la barre d’état adopte la couleur du thème clair ou sombre.",
      },
      {
        q: "Comment mise à jour l’application installée ?",
        a: "Elle se met à jour toute seule ; une bannière « Mise à jour prête » propose de recharger quand une nouvelle version attend. Rien à désinstaller.",
      },
    ],
  },
  {
    theme: "Publier et échanger",
    items: [
      {
        q: "Comment publier du code ?",
        a: "Dans le composeur du fil, active le bloc de code : un post avec code rapporte plus de points, et c’est ce qu’on relit six mois plus tard.",
      },
      {
        q: "Qui peut m’envoyer un message privé ?",
        a: "Tout le monde peut te répondre. Un compte étudiant ne peut pas initier un message vers un professionnel : la conversation doit venir du professionnel.",
      },
      {
        q: "Comment bloquer quelqu’un ?",
        a: "Depuis un profil, « Bloquer ». Un compte bloqué ne peut plus te suivre ni interagir avec toi, et ses contenus te sont masqués. Tu peux débloquer à tout moment depuis tes paramètres.",
      },
    ],
  },
  {
    theme: "Projets et exécution",
    items: [
      {
        q: "Le code s’exécute-t-il sur vos serveurs ?",
        a: "Non. L’exécution se fait dans ton navigateur : Python, JavaScript, TypeScript, C, C++, Ruby, PHP et SQL. Aucun code d’un membre ne tourne chez DevNet.",
      },
      {
        q: "Pourquoi certains langages ne s’exécutent pas ?",
        a: "L’exécution tient au navigateur et à WebAssembly. Les langages proposés ont un moteur qui tourne dans cette limite ; d’autres, comme Go, Rust, Julia ou Lean, demandent des chaînes d’outils trop lourdes pour le navigateur. Ils restent lisibles et colorés dans l’éditeur.",
      },
      {
        q: "Comment relier mon dépôt GitHub ?",
        a: "Depuis l’onglet GitHub d’un projet, connecte ton compte et importe le dépôt. La connexion est personnelle, le jeton n’est pas conservé en clair, et rien n’est envoyé vers GitHub sans une action explicite.",
      },
    ],
  },
  {
    theme: "Confidentialité et signalements",
    items: [
      {
        q: "Mes données de démonstration sont-elles réelles ?",
        a: "Non. En mode démonstration, profils et contenus sont fictifs et restent dans le stockage local de ton navigateur. Ils ne quittent pas ton appareil.",
      },
      {
        q: "Comment signaler un contenu ?",
        a: "Un bouton « Signaler » est disponible sur les profils et les publications. Les signalements concernant tes contenus apparaissent dans l’écran Modération.",
      },
      {
        q: "Comment exercer mes droits sur mes données ?",
        a: "Écris à l’adresse de contact ci-dessous. La politique de confidentialité détaille les données traitées et tes droits d’accès, de rectification et de suppression.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <main className="mo-rise min-h-dvh px-5">
      <header className="mx-auto flex h-(--h-topbar) max-w-[900px] items-center border-b border-line-2 safe-top">
        <Link href="/" className="font-display text-lg font-bold text-chalk">
          DevNet<span className="text-signal">.</span>
        </Link>
        <Link href="/a-propos" className="ml-auto text-[13px] font-bold text-chalk-3 hover:text-chalk">
          À propos
        </Link>
      </header>

      <article className="mx-auto max-w-[760px] py-12 sm:py-16">
        <p className="label prompt-label text-signal">Support</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
          Aide
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-chalk-3">
          Les questions les plus courantes, et où trouver le reste. Si ta question
          n’est pas ici, écris-nous.
        </p>

        <div className="mt-9 space-y-9">
          {FAQ.map((group) => (
            <section key={group.theme}>
              <h2 className="font-display text-xl font-bold text-chalk">{group.theme}</h2>
              <div className="mt-3 space-y-4">
                {group.items.map((item) => (
                  <div key={item.q} className="rounded-(--radius-card) border border-line-2 bg-surface p-4">
                    <h3 className="font-display text-[15px] font-bold text-chalk">{item.q}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-chalk-3">{item.a}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-10 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">Nous contacter</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Pour toute question, un bug ou une demande sur tes données :{" "}
            <a href="mailto:kichub404@gmail.com" className="text-signal underline">kichub404@gmail.com</a>.
          </p>
          <p className="mt-3 text-sm text-chalk-3">
            Voir aussi l’<Link href="/a-propos" className="text-signal underline">à propos</Link>, les{" "}
            <Link href="/cgu" className="text-signal underline">conditions générales d’utilisation</Link>{" "}
            et la <Link href="/confidentialite" className="text-signal underline">politique de confidentialité</Link>.
          </p>
        </section>
      </article>
      <PublicFooter />
    </main>
  );
}
