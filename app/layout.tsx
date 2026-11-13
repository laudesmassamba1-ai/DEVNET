import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import { BackendGate } from "@/components/BackendGate";
import { EventPump } from "@/components/EventPump";
import { PwaManager } from "@/components/PwaManager";
import { SplashScreen } from "@/components/SplashScreen";
import { ThemeApplier } from "@/components/ThemeApplier";
import { ToastProvider } from "@/components/Toast";
import { TourProvider } from "@/components/TourProvider";
import { DEFAULT_THEME, LIGHT_THEME, THEME_STORAGE_KEY } from "@/lib/theme";
import { PWA_ICONS, PWA_SHORT_NAME, PWA_THEME_COLOR } from "@/lib/pwa";
import { REDUCED_MOTION_KEY } from "@/lib/ui-preferences";
import "./globals.css";

/**
 * Typographie DevNet — deux familles, deux rôles.
 *
 * - **Instrument Sans** — interface et lecture, avec une graisse variable
 *   pour garder une hiérarchie nette sans ajouter une troisième famille.
 * - **IBM Plex Mono** — la donnée : compteurs, pseudos, libellés de
 *   colonne, code. Le mono n'est pas un effet « technique », c'est ce qui
 *   fait qu'un compteur ne saute pas et qu'une colonne s'aligne.
 */

const instrumentSans = localFont({
  src: "./fonts/InstrumentSansVariable.ttf",
  display: "swap",
  variable: "--font-instrument",
  weight: "400 700",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/IBMPlexMono-Regular.ttf", weight: "400" },
    { path: "./fonts/IBMPlexMono-Medium.ttf", weight: "500" },
    { path: "./fonts/IBMPlexMono-SemiBold.ttf", weight: "600" },
    { path: "./fonts/IBMPlexMono-Bold.ttf", weight: "700" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "DevNet — Le réseau des développeurs africains",
  description:
    "La plateforme d'échange entre étudiants et professionnels du numérique en Afrique.",
  applicationName: PWA_SHORT_NAME,
  appleWebApp: {
    capable: true,
    title: PWA_SHORT_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: PWA_ICONS.icon48, sizes: "48x48", type: "image/png" },
      { url: PWA_ICONS.icon192, sizes: "192x192", type: "image/png" },
      { url: PWA_ICONS.icon512, sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: PWA_ICONS.appleTouch, sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/favicon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const mediaOrigin = process.env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "";

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
      className={`${instrumentSans.variable} ${plexMono.variable}`}
      // Le thème est posé sur `<html>` avant l'hydratation (script plus
      // bas) : le serveur ne peut pas le connaître, on autorise l'écart.
      suppressHydrationWarning
    >
      <body className="antialiased">
        {/*
          Les médias vivent sur R2, pas sur le domaine de l'app : sans
          indication, le navigateur ne résout ce domaine qu'au moment de la
          première image, ce qui ajoute une poignée de main TLS au chargement
          du fil. Deux `<link>` suffisent, sans dépendance.
        */}
        {mediaOrigin ? (
          <>
            <link rel="preconnect" href={mediaOrigin} crossOrigin="" />
            <link rel="dns-prefetch" href={mediaOrigin} />
          </>
        ) : null}
        {/*
          Le thème doit être appliqué **avant** le premier rendu, sinon un
          utilisateur en thème clair voit un flash ivoire. Ce script lit la
          copie locale et pose `data-theme` sur `<html>` dès l'HTML initial ;
          `ThemeApplier` resynchronise ensuite avec la valeur en base.
        */}
        <Script id="devnet-theme" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});document.documentElement.dataset.theme=t===${JSON.stringify(LIGHT_THEME)}?${JSON.stringify(LIGHT_THEME)}:${JSON.stringify(DEFAULT_THEME)};document.documentElement.dataset.reduceMotion=localStorage.getItem(${JSON.stringify(REDUCED_MOTION_KEY)})==="true"?"true":"false";}catch(e){}`}
        </Script>
        {/*
          `beforeinstallprompt` part **avant** l'hydratation : le navigateur
          décide que l'application est installable en lisant le manifeste,
          puis émet l'événement pendant le chargement de la page. Un écouteur
          posé dans un `useEffect` arrive après, et l'événement est perdu —
          l'invite d'installation ne s'affichait donc jamais. On le capture
          ici, dès l'HTML initial, et on le signale à React.
        */}
        <Script id="devnet-install-prompt" strategy="beforeInteractive">
          {`window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__devnetInstallPrompt=e;window.dispatchEvent(new Event("devnet:install-available"));});`}
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
          <PwaManager>
            <TourProvider>
              <BackendGate>{children}</BackendGate>
              <EventPump />
            </TourProvider>
          </PwaManager>
        </ToastProvider>
      </body>
    </html>
  );
}
