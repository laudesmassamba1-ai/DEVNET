"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";

/**
 * Pivot du lancement.
 *
 * `/` n'a plus son propre écran : la scène de lancement (le logo qui se
 * construit en cel shading) est portée par le layout
 * (`components/SplashScreen`) et reste affichée pendant que la
 * redirection déroule dessous — donc la construction ne se joue qu'une
 * fois par chargement réel, au lieu de deux écrans qui se chevauchaient
 * (l'ancienne version empilait un second splash plein écran par-dessus
 * celui du layout).
 *
 * La redirection attend le verdict de la session (connecté → /feed,
 * sinon → /login) ; le splash couvre ce temps et se dissout ensuite.
 */
export default function AccueilPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return; // on attend le verdict de session
    const t = setTimeout(() => {
      router.replace(session ? "/feed" : "/login");
    }, 0);
    return () => clearTimeout(t);
  }, [loading, session, router]);

  return null;
}
