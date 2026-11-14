import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Conditions générales d’utilisation — DevNet",
  description: "Conditions d’utilisation du prototype DevNet.",
};

const TERMS = [
  {
    title: "1. Objet et acceptation",
    text: "Les présentes conditions encadrent l’accès et l’utilisation de DevNet. En créant un compte ou en utilisant les fonctionnalités nécessitant un compte, vous reconnaissez en avoir pris connaissance. Si vous ne les acceptez pas, n’utilisez pas ces fonctionnalités.",
  },
  {
    title: "2. Accès et compte",
    text: "Vous devez fournir des informations exactes, protéger vos identifiants et signaler tout accès non autorisé. Un compte est personnel, et vous êtes responsable des activités réalisées depuis le vôtre. DevNet peut limiter ou suspendre un compte en cas de risque pour les personnes, les données ou le service. Vous pouvez demander la fermeture de votre compte par les moyens de contact indiqués ci-dessous.",
  },
  {
    title: "3. Règles d’utilisation",
    text: "Vous vous engagez à respecter les lois applicables, les droits d’autrui et les règles de la communauté. Sont notamment interdits : les contenus illicites ou frauduleux, le harcèlement, les menaces, l’usurpation d’identité, le spam, l’accès non autorisé, les tentatives de perturber le service ou un service tiers depuis les outils d’exécution, et la publication de secrets ou de données personnelles sans autorisation.",
  },
  {
    title: "4. Contenus publiés",
    text: "Vous conservez les droits sur les contenus que vous créez. Vous autorisez DevNet à les héberger, afficher et traiter dans la mesure nécessaire au fonctionnement du service et aux interactions que vous choisissez. Vous garantissez disposer des droits nécessaires et ne pas publier de contenus portant atteinte aux droits de tiers. Vous pouvez supprimer les contenus selon les fonctionnalités disponibles, sous réserve des obligations légales et des sauvegardes techniques temporaires.",
  },
  {
    title: "5. Code, dépôts et exécution",
    text: "Vous êtes responsable du code et des fichiers que vous ajoutez. Chaque projet comporte un dépôt de type git : branches, commits, issues, demandes de fusion et wiki relèvent de votre responsabilité, comme sur tout gestionnaire de versions. L’exécution de code est fournie à titre d’outil et s’effectue dans votre navigateur ; elle peut comporter des limites techniques (délai, mémoire, taille de sortie, nombre de fichiers). Vérifiez le code avant de l’exécuter et n’exécutez pas de code dont vous ne comprenez pas l’origine.",
  },
  {
    title: "6. Scores, preuves et progression",
    text: "Les scores, la progression (paliers, séries, défis, badges) et les preuves d’activité sont calculés à partir de vos contenus et de votre activité. Ils sont indicatifs, peuvent être incomplets ou inexacts, et ne valent ni certification, ni garantie de recrutement, ni conseil professionnel.",
  },
  {
    title: "7. GitHub et services tiers",
    text: "Vous pouvez relier un projet à un dépôt GitHub avec votre propre compte. La connexion est personnelle, et le jeton d’accès n’est pas conservé en clair. Le projet DevNet reste la source de vérité : rien n’est envoyé vers GitHub sans une action explicite de votre part. Publier rend le code public, ce qui est une décision et non un effet de bord. Certaines fonctions dépendent de services tiers et de votre connexion ; DevNet ne garantit ni leur disponibilité ni leur continuité.",
  },
  {
    title: "8. Modération",
    text: "Vous pouvez signaler un contenu depuis les outils proposés. DevNet peut examiner les signalements et retirer ou limiter l’accès à un contenu ou à un compte qui enfreint ces conditions ou la loi. Lorsque cela est possible, une mesure sera accompagnée d’une information et d’un moyen de la contester.",
  },
  {
    title: "9. Disponibilité",
    text: "Le service peut évoluer, être interrompu pour maintenance ou devenir temporairement indisponible. DevNet ne garantit pas une disponibilité continue ni la conservation permanente des données ; gardez une copie de vos travaux importants.",
  },
  {
    title: "10. Données personnelles",
    text: "Les données nécessaires au compte et aux fonctions utilisées sont traitées pour fournir le service, assurer sa sécurité et répondre aux obligations applicables. En démonstration, les données sont fictives et enregistrées localement dans le navigateur. Le détail des données traitées, des durées de conservation et des moyens d’exercer vos droits figure dans la politique de confidentialité, accessible depuis ces conditions et le pied de page.",
  },
  {
    title: "11. Responsabilité",
    text: "Dans les limites permises par la loi, vous restez responsable de vos usages, de vos contenus et des décisions prises à partir des scores ou recommandations. DevNet ne peut exclure les responsabilités que la loi rend impératives. Signalez rapidement tout incident ou contenu dangereux.",
  },
  {
    title: "12. Modification et fin d’utilisation",
    text: "Les présentes conditions peuvent être mises à jour pour refléter l’évolution du service ou de la réglementation. La version publiée indique sa date d’entrée en vigueur. Vous pouvez cesser d’utiliser DevNet et demander la fermeture de votre compte par les moyens de contact indiqués.",
  },
  {
    title: "13. Droit applicable et litiges",
    text: "Sous réserve des règles impératives applicables dans le pays où vous résidez, les présentes conditions sont régies par le droit de la République du Congo. Les parties chercheront d’abord une solution amiable; à défaut, le litige sera soumis aux juridictions compétentes conformément aux règles applicables.",
  },
  {
    title: "14. Contact",
    text: "Pour toute question concernant ces conditions, un compte ou les données personnelles, écrivez à kichub404@gmail.com.",
  },
];

export default function TermsPage() {
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
        <p className="label prompt-label text-signal">Règles du service</p>
        <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
          Conditions générales d’utilisation
        </h1>
        <p className="mt-3 text-sm text-chalk-4">Version du 16 octobre 2026</p>
        <div className="mt-8 space-y-7">
          {TERMS.map((term) => (
            <section key={term.title}>
              <h2 className="font-display text-lg font-bold text-chalk">{term.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-chalk-3">{term.text}</p>
            </section>
          ))}
        </div>
        <p className="mt-10 border-t border-warn/50 pt-5 text-xs leading-relaxed text-chalk-4">
          DevNet est un prototype de hackathon. L’identité juridique et l’adresse postale de son éditeur
          ne sont pas encore définies; ces conditions sont donc provisoires et ne remplacent pas un avis
          juridique. La politique de confidentialité est publiée mais reste provisoire : elle devra être
          précisée et validée localement avant toute exploitation durable du service.
        </p>
        <p className="mt-5 text-sm text-chalk-3">
          Voir aussi la{" "}
          <Link href="/confidentialite" className="text-signal underline">politique de confidentialité</Link>
          {" "}et la{" "}
          <Link href="/aide" className="text-signal underline">page d’aide</Link>.
        </p>
      </article>
      <PublicFooter />
    </main>
  );
}
