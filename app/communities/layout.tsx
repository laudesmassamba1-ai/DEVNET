import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Communautés — DevNet",
  description: "Les communautés techniques de DevNet, leurs canaux et leurs dépôts.",
};

export default function CommunitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
