import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Groupes — DevNet",
  description: "Vos groupes de travail et leurs canaux de discussion.",
};

export default function GroupsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
