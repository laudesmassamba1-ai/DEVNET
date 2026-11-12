import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Signets — DevNet",
  description: "Les publications que vous avez gardées pour plus tard.",
};

export default function BookmarksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
