import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profil public — DevNet",
  description: "Le profil public d'un membre de DevNet : preuves, projets et publications.",
};

export default function PublicProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
