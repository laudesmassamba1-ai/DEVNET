import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projets — DevNet",
  description:
    "Les dépôts de la communauté : découvrez, filtrez et rejoignez un projet selon vos preuves.",
};

export default function ProjectsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
