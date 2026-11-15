import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Politique de confidentialité — DevNet",
  description: "Quelles données DevNet traite, pourquoi, et comment exercer vos droits.",
};

const SECTIONS = [
  {
    title: "1. Éditeur et portée",
    text: "DevNet est un prototype présenté dans le cadre d’un hackathon. L’identité juridique et l’adresse postale de son éditeur ne sont pas encore définies. La présente politique décrit, aussi précisément que possible à ce stade, quelles données sont traitées et dans quel but. Elle sera complétée et datée avant toute exploitation durable du service.",
  },
  {
    title: "2. Quelles données nous traitons",
    text: "Données de compte : prénom, pseudo, adresse email, filière, niveau d’études, langages maîtrisés, couleur d’avatar et type de compte (étudiant ou professionnel). Contenus : publications, commentaires, messages, projets, code, fichiers, réactions et signalements que vous créez. Activité : likes, abonnements, signets, progression, preuves et score calculés à partir de vos contenus. Connexion GitHub : lorsque vous reliez un projet, l’identifiant du compte GitHub lié et une référence vers votre jeton d’accès.",
  },
  {
    title: "3. Pourquoi nous les traitons",
    text: "Ces données servent à fournir le service : authentifier votre compte, afficher vos contenus et ceux des personnes que vous suivez, faire fonctionner les messages, les projets et l’exécution de code, calculer votre progression et votre score, et assurer la sécurité et la modération de la plateforme. Aucune donnée n’est utilisée pour de la publicité ciblée, et rien n’est vendu à des tiers.",
  },
  {
    title: "4. Où et comment elles sont conservées",
    text: "En mode connecté, les données sont stockées dans une base PostgreSQL hébergée par un prestataire (Systalink), protégée par des règles d’accès au niveau des lignes et chiffrée en transit. En mode démonstration, lorsque le backend n’est pas joignable, les données sont fictives et enregistrées uniquement dans le stockage local de votre navigateur : elles ne quittent pas votre appareil. Le jeton GitHub n’est jamais conservé en clair ; la base n’en garde qu’une référence.",
  },
  {
    title: "5. Services tiers",
    text: "Le service s’appuie sur des prestataires tiers : hébergement de la base de données (Systalink), connexion GitHub si vous l’activez, et distribution des moteurs d’exécution de code. L’exécution du code se fait dans votre navigateur ; le code que vous exécutez n’est pas envoyé à nos serveurs. Chacun de ces prestataires a sa propre politique de confidentialité.",
  },
  {
    title: "6. Durées de conservation",
    text: "Vos données de compte et vos contenus sont conservés tant que votre compte existe. Vous pouvez supprimer vos contenus depuis les fonctionnalités disponibles, et demander la suppression de votre compte par les moyens de contact ci-dessous. Des sauvegardes techniques temporaires peuvent subsister après une suppression, le temps que le cycle de sauvegarde se termine.",
  },
  {
    title: "7. Vos droits",
    text: "Vous pouvez demander à accéder à vos données, les faire rectifier ou supprimer, et vous opposer à certains traitements. Pour exercer ces droits, écrivez à l’adresse de contact ci-dessous. Une réponse vous sera apportée dans les meilleurs délais.",
  },
  {
    title: "8. Stockage local et cookies",
    text: "L’application utilise le stockage du navigateur et des cookies techniques pour maintenir votre session, mémoriser le thème choisi et faire fonctionner le mode démonstration hors ligne. Ces éléments sont nécessaires au fonctionnement du service et ne servent pas au suivi publicitaire.",
  },
  {
    title: "9. Sécurité",
    text: "L’accès aux données est restreint par des règles appliquées à la base elle-même, et non seulement par l’interface. Malgré ces précautions, aucun service ne peut garantir une sécurité absolue : ne publiez jamais de secrets, de clés ou de données personnelles d’autrui.",
  },
  {
    title: "10. Mineurs",
    text: "Le service n’est pas destiné aux personnes n’ayant pas l’âge requis pour consentir seules au traitement de leurs données dans leur pays. Si vous êtes mineur, demandez l’accord d’un responsable.",
  },
  {
    title: "11. Modifications",
    text: "Cette politique peut évoluer avec le service. La version publiée indique sa date. En cas de changement important, une information sera affichée sur la plateforme.",
  },
  {
    title: "12. Contact",
    text: "Pour toute question relative à vos données ou pour exercer vos droits, écrivez à kichub404@gmail.com.",
  },
];

export default function PrivacyPage() {
  return (
    <main className="mo-rise min-h-dvh px-5">
      <header className="mx-auto flex h-(--h-topbar) max-w-[900px] items-center border-b border-line-2 safe-top">
        <Link href="/" className="font-display text-lg font-bold text-chalk">
          DevNet<span className="text-signal">.</span>
        </Link>
        <Link href="/a-propos" className="ml-auto text-13 font-bold text-chalk-3 hover:text-chalk">
          À propos
        </Link>
      </header>

      <article className="mx-auto max-w-[760px] py-12 sm:py-16">
        <p className="label prompt-label text-signal">Vos données</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
          Politique de confidentialité
        </h1>
        <p className="mt-3 text-sm text-chalk-4">Version du 16 octobre 2026</p>
        <div className="mt-8 space-y-7">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-lg font-bold text-chalk">{section.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-chalk-3">{section.text}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 border-t border-line-2 pt-5 text-sm text-chalk-3">
          Les règles d’usage de la plateforme sont décrites dans les{" "}
          <Link href="/cgu" className="text-signal underline">conditions générales d’utilisation</Link>.
        </p>
        <p className="mt-5 border-t border-warn/50 pt-5 text-xs leading-relaxed text-chalk-4">
          DevNet est un prototype de hackathon. Cette politique est provisoire et ne
          remplace pas un avis juridique ; elle sera précisée et validée localement
          avant toute exploitation durable du service.
        </p>
      </article>
      <PublicFooter />
    </main>
  );
}
