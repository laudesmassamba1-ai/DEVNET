import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Extensions — DevNet",
  description:
    "Les extensions de la communauté : outils, thèmes et modules à installer.",
};

export default function ExtensionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
