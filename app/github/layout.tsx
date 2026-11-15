import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitHub — DevNet",
  description: "Le lien entre vos dépôts GitHub et votre travail sur DevNet.",
};

export default function GithubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
