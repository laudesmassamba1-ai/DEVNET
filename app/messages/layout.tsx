import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Messages — DevNet",
  description: "Vos conversations privées et vos groupes sur DevNet.",
};

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
