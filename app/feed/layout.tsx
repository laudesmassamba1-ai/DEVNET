import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fil — DevNet",
  description:
    "Le fil chronologique des développeurs africains : du code, des preuves, des projets.",
};

export default function FeedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
