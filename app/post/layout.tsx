import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Publication — DevNet",
  description: "Une publication et sa discussion.",
};

export default function PostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
