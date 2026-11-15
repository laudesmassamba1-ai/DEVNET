import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notifications — DevNet",
  description: "Vos mentions, réponses, abonnements et activités de modération.",
};

export default function NotificationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
