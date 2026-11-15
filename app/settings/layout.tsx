import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Paramètres — DevNet",
  description:
    "Compte, apparence, notifications, données personnelles et diagnostic de DevNet.",
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
