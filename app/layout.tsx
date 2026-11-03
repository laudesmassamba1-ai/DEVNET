import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { BackendGate } from "@/components/BackendGate";
import { ChallengeNotification } from "@/components/ChallengeNotification";
import { SplashScreen } from "@/components/SplashScreen";
import { ThemeApplier } from "@/components/ThemeApplier";
import { ToastProvider } from "@/components/Toast";
import { TourProvider } from "@/components/TourProvider";
import { DEFAULT_THEME, LIGHT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";
import "./globals.css";

/**
 * Typographie DevNet — deux familles, deux rôles.
 *
 * - **Inter** — tout le texte, titres compris. Grotesque neutre, dessinée
 *   pour l'écran : c'est la police que lisent les interfaces les plus
 *   soignées (Notion et ses équivalents), et sa graisse variable couvre
 *   aussi bien un libellé de 11 px qu'un titre de 28 px sans changer de
 *   dessin. Les titres se distinguent du corps par le **poids** et
 *   l'interlettrage, pas par une seconde famille.
 * - **IBM Plex Mono** — la donnée : compteurs, pseudos, libellés de
 *   colonne, code. Le mono n'est pas un effet « technique », c'est ce qui
 *   fait qu'un compteur ne saute pas et qu'une colonne s'aligne.
 */

const inter = localFont({
  src: "./fonts/Inter[opsz,wght].ttf",
  display: "swap",
  variable: "--font-inter",
  weight: "100 900",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500" },
    { path: "./fonts/IBMPlexMono-SemiBold.ttf", weight: "600" },
    { path: "./fonts/IBMPlexMono-Bold.ttf", weight: "700" },
  ],
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "DevNet — Le réseau des développeurs africains",
  description:
    "La plateforme d'échange entre étudiants et professionnels du numérique en Afrique.",
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#F1EFE6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Les variables de police doivent être sur <html> : une custom property
  // contenant var() est résolue là où elle est déclarée, donc sur :root.
  // Si next/font les posait sur <body>, --font-sans serait invalide à
  // la racine et le fallback système s'appliquerait partout.
  return (
    <html
      lang="fr"
      // `scroll-behavior: smooth` sert aux ancres internes ; cet attribut
      // dit à Next de ne pas l'appliquer pendant une navigation de route,
      // sinon la page défile visiblement vers le haut à chaque clic.
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${plexMono.variable}`}
      // Le thème est posé sur `<html>` avant l'hydratation (script plus
      // bas) : le serveur ne peut pas le connaître, on autorise l'écart.
      suppressHydrationWarning
    >
      <body className="antialiased">
        {/*
          Le thème doit être appliqué **avant** le premier rendu, sinon un
          utilisateur en thème clair voit un flash ivoire. Ce script lit la
          copie locale et pose `data-theme` sur `<html>` dès l'HTML initial ;
          `ThemeApplier` resynchronise ensuite avec la valeur en base.
        */}
        <Script id="devnet-theme" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=t===${JSON.stringify(LIGHT_THEME)}?${JSON.stringify(LIGHT_THEME)}:${JSON.stringify(DEFAULT_THEME)};}catch(e){}`}
        </Script>
        {/*
          `ToastProvider` était écrit, exporté… et monté nulle part.

          `useToast()` renvoie alors la fonction vide du contexte par
          défaut, donc **tous** les `toast(…)` de l'application étaient
          des no-ops : « lien copié », « suivi impossible », « commentaire
          supprimé » ne s'affichaient jamais. Le bouton fonctionnait, la
          confirmation disparaissait — ce qui est pire que de ne pas avoir
          de bouton, parce que l'interface promet alors une réponse.

          Il entoure `BackendGate` pour être au-dessus de toutes les pages,
          y compris de l'écran de connexion.
        */}
        {/*
          L'écran de lancement vit au-dessus de tout : pendant sa scène,
          la page est vide et le logo se construit étape par étape.
          Hors de `ToastProvider` volontairement — la scène ne doit
          rien devoir à l'état de session ni aux toasts.
        */}
        <SplashScreen />
        <ToastProvider>
          {/*
            `ThemeApplier` applique `users.theme` à `<html>` dès que le
            profil est résolu. Le script `beforeInteractive` ci-dessus a
            déjà posé le thème mémorisé pour éviter le flash ; ce composant
            le remet d'aplomb avec la valeur réellement stockée en base.
          */}
          <ThemeApplier />
          {/*
            La prise en main (`TourProvider`) enveloppe les pages plutôt
            que de vivre dans chacune : elle doit pouvoir guider d'un
            écran à l'autre, donc rester montée pendant les navigations.
            Elle ne s'arme toutefois que lorsque la session porte un
            profil, et jamais sur les écrans publics.
          */}
          <TourProvider>
            <BackendGate>{children}</BackendGate>
          </TourProvider>
          {/*
            Les défis du jour ne sont plus ancrés dans le fil : ils
            arrivent en **notification**, une fois par heure, au-dessus de
            l'interface. Monté ici, dans le layout, le pop up vit sur tous
            les écrans protégés sans qu'aucune page ait à le citer — donc
            il ne peut pas être oublié en ajoutant une route. Il ne
            s'affiche que lorsque la session porte un profil.
          */}
          <ChallengeNotification />
        </ToastProvider>
      </body>
    </html>
  );
}
