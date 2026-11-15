import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Stickers — DevNet",
  description: "Le catalogue de stickers et le studio de création.",
};

export default function StickersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
