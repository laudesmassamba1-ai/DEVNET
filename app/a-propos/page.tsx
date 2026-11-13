import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "À propos — DevNet",
  description: "Présentation, fonctionnalités et fonctionnement de DevNet.",
};

const FEATURES = [
  {
    title: "Fil et stories",
    text: "Publie des posts — texte ou code —, réagis, commente et repartage. Les stories rappellent qui a publié dans les dernières 24 heures.",
  },
  {
    title: "Communautés",
    text: "Rejoins des communautés ouvertes ou crée la tienne, et retrouve les publications qui s’y rattachent.",
  },
  {
    title: "Groupes et canaux",
    text: "Organise une équipe en groupes, avec des canaux de discussion séparés et des rôles de membres.",
  },
  {
    title: "Messages privés",
    text: "Échange en direct : accusés de lecture, réponses citées, réactions et messages épinglés.",
  },
  {
    title: "Projets et dépôt",
    text: "Crée un projet et travaille dans un dépôt conforme à git : branches, commits, diffs, issues, demandes de fusion, wiki, tâches et forks.",
  },
  {
    title: "IDE dans le navigateur",
    text: "Écris et exécute du code dans huit langages, directement dans le navigateur, sans serveur distant.",
  },
  {
    title: "GitHub",
    text: "Relie un projet à un dépôt GitHub, importe un dépôt existant et synchronise tes commits dans les deux sens.",
  },
  {
    title: "Progression et score",
    text: "Gagne des paliers, des séries, des défis et des badges, et suis un score indicatif de la qualité de ton code.",
  },
  {
    title: "Recherche et signets",
    text: "Trouve des personnes, des posts et des mots-clés, et garde ce que tu veux relire dans des signets privés.",
  },
];

export default function AboutPage() {
  return (
    <main className="mo-rise min-h-dvh px-5">
      <header className="mx-auto flex h-[var(--h-topbar)] max-w-[900px] items-center border-b border-line-2 safe-top">
        <Link href="/" className="font-display text-lg font-bold text-chalk">
          DevNet<span className="text-signal">.</span>
        </Link>
        <Link href="/login" className="ml-auto text-[13px] font-bold text-chalk-3 hover:text-chalk">
          Connexion
        </Link>
      </header>

      <article className="mx-auto max-w-[760px] py-12 sm:py-16">
        <p className="label prompt-label text-signal">À propos</p>
        <h1 className="mo-soft mt-3 font-display text-4xl font-bold tracking-tight text-chalk">
          Les développeurs d’Afrique, réunis.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-chalk-3">
          DevNet rassemble étudiants et professionnels du numérique autour d’un
          même endroit : publier, apprendre, construire à plusieurs et montrer
          ce qu’on sait faire. Tout ce qu’on y écrit du code est exécutable et
          peut être relié à un vrai dépôt GitHub.
        </p>

        <section className="mt-10 grid gap-3 sm:grid-cols-2" aria-label="Fonctionnalités">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-[var(--radius-card)] border border-line-2 bg-surface p-4">
              <h2 className="font-display text-lg font-bold text-chalk">{feature.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-chalk-3">{feature.text}</p>
            </div>
          ))}
        </section>

        <section className="mt-10 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">Étudiant ou professionnel</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Le type de compte n’est pas une étiquette mais une échelle de
            capacités. Un compte étudiant se crée en quelques secondes et peut
            publier, commenter et rejoindre des groupes. Un compte professionnel
            peut en plus être visible des recruteurs, porter un badge vérifié et
            recevoir un message privé d’un étudiant.
          </p>
        </section>

        <section className="mt-8 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">Le dépôt et l’exécution</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Chaque projet contient un dépôt qui suit le modèle d’objets de git :
            l’identité d’un fichier, d’un arbre ou d’un commit est le hachage de
            son contenu, exactement comme dans git. On y crée des branches, on
            enregistre des commits, on ouvre des issues et des demandes de
            fusion, et l’on documente le projet dans un wiki. Deux personnes qui
            modifient le même fichier doivent le voir : rien n’est fusionné
            automatiquement.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-chalk-3">
            Le code s’exécute <span className="text-chalk">dans ton navigateur</span>,
            jamais sur un serveur à nous : Python, JavaScript, TypeScript, C,
            C++, Ruby, PHP et SQL. Aucun code d’un membre ne tourne chez DevNet,
            et l’exécution fonctionne hors ligne — utile quand la connexion est
            le premier obstacle. Les ressources (délai, taille de sortie,
            nombre de fichiers) sont bornées.
          </p>
        </section>

        <section className="mt-8 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">GitHub</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Un projet peut être relié à un dépôt GitHub avec ton propre compte :
            importe un dépôt existant, affiche ses fichiers et son historique,
            puis synchronise tes commits. La connexion est personnelle — personne
            ne pousse avec le jeton d’un autre — et le jeton n’est jamais
            conservé en clair. Le projet DevNet reste la source de vérité, et
            rien n’est envoyé vers GitHub sans une action explicite de ta part.
          </p>
        </section>

        <section className="mt-8 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">Le score</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            Le score analyse le code (Halstead, McCabe, Campbell, Oman-Hagemeister) et ajoute
            15 % d’hygiène (README, licence, tests détectés, CI). Les tests ne sont pas exécutés.
            Ces indicateurs ne certifient ni les compétences ni la qualité du code.
          </p>
        </section>

        <section className="mt-8 border-t border-line-2 pt-6">
          <h2 className="font-display text-xl font-bold text-chalk">Données et démonstration</h2>
          <p className="mt-2 text-sm leading-relaxed text-chalk-3">
            En démonstration, profils et contenus sont fictifs et stockés dans le navigateur.
            Ne publie jamais de secrets ni de données personnelles.
          </p>
        </section>

        <p className="mt-8 text-sm text-chalk-3">
          Les règles d’utilisation sont présentées dans les{" "}
          <Link href="/cgu" className="text-signal underline">conditions générales d’utilisation</Link>.
        </p>
        <p className="mt-5 text-sm text-chalk-3">
          Contact : <a href="mailto:kichub404@gmail.com" className="text-signal underline">kichub404@gmail.com</a>
        </p>
        <p className="mt-5 text-xs text-chalk-4">
          DevNet est un prototype présenté dans le cadre d’un hackathon.
        </p>
      </article>
      <PublicFooter />
    </main>
  );
}
