import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recherche — DevNet",
  description:
    "Recherchez des publications, des personnes, des projets et des hashtags.",
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
