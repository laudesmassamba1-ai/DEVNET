import { AppShell } from "@/components/AppShell";
import { ProtectionPanel } from "@/components/ProtectionPanel";

export const metadata = { title: "Protection — DevNet" };

export default function ProtectionSettingsPage() {
  return (
    <AppShell title="Protection" path="~/settings/protection">
      <ProtectionPanel />
    </AppShell>
  );
}
