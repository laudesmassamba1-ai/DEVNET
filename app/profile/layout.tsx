import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profil — DevNet",
  description:
    "Votre profil, votre progression, vos dépôts et vos preuves sur DevNet.",
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
