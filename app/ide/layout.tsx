import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Éditeur — DevNet",
  description: "L'éditeur de code et le bac à sable de DevNet.",
};

export default function IdeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
