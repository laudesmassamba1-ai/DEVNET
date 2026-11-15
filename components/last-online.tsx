"use client";

import { useEffect, useState } from "react";
import { readLastOnline } from "@/lib/offline-cache";

/** Marqueur « déjà été en ligne sur cet appareil », lu après hydration. */
export function useLastOnline(): boolean {
  const [wasOnline, setWasOnline] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la donnée locale n'existe pas au rendu serveur
    setWasOnline(readLastOnline());
  }, []);

  return wasOnline;
}
