import {
  ImportDisabledNotice,
  ImportWorkspace,
} from "@/components/import-workspace";
import { requireTenant } from "@/server/auth/current-session";
import { isDemoMode } from "@/server/demo-mode";

export default async function SettingsPage() {
  await requireTenant();
  return isDemoMode() ? <ImportDisabledNotice /> : <ImportWorkspace />;
}
