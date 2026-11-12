import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Modération — DevNet",
  description: "Les signalements et les décisions de modération.",
};

export default function ModerationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
