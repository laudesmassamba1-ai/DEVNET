import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Découvrir — DevNet",
  description:
    "Des personnes, des projets et des preuves à découvrir sur DevNet.",
};

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
