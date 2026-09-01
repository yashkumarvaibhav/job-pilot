import { SettingsNav } from "@/components/settings-nav";
import type { ReactNode } from "react";

export default function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="settings-page">
      <SettingsNav />
      {children}
    </div>
  );
}
