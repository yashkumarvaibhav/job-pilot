import { AutomationRulesPanel } from "@/components/automation-rules-panel";
import { ExportPanel } from "@/components/export-panel";
import {
  GmailAccountsPanel,
  type GmailAccountCard,
} from "@/components/gmail-accounts-panel";
import { SettingsForm } from "@/components/settings-form";
import { AUTOMATION_RULES_TITLE } from "@/domain/rules";
import {
  formatClockMinutes,
  quietHoursStateLine,
  selectableTimeZones,
} from "@/domain/settings";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readGmailOAuthAvailability } from "@/server/mail/google-config";
import { readWorkspaceSettings } from "@/server/repos/settings";
import { listEmailAccounts } from "@/server/repos/email-accounts";
import { listAutomationRules } from "@/server/repos/rules";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  const view = readWorkspaceSettings(database, tenant);
  const gmailAvailability = readGmailOAuthAvailability();
  const gmailAccounts: GmailAccountCard[] = listEmailAccounts(database, tenant).map(
    (account) => ({
      id: account.id,
      email: account.email,
      senderName: account.senderName,
      signature: account.signature,
      replyTo: account.replyTo,
      dailyLimit: account.dailyLimit,
      sendingWindowStart: account.sendingWindowStart,
      sendingWindowEnd: account.sendingWindowEnd,
      status: account.status,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      isDefault: account.isDefault,
    }),
  );
  const quietState = quietHoursStateLine(
    view.timezone,
    new Date(),
    view.quietStart,
    view.quietEnd,
  );

  return (
    <section className="settings-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Workspace</h1>
          <p className="page-lede">
            Who you are in your own templates, which clock this workspace reads,
            and when it should stop emailing you.
          </p>
        </div>
      </header>

      <SettingsForm
        quietState={quietState}
        timeZones={selectableTimeZones(view.timezone)}
        values={{
          displayName: view.displayName,
          university: view.university ?? "",
          timezone: view.timezone,
          quietStart:
            view.quietStart == null ? "" : formatClockMinutes(view.quietStart),
          quietEnd:
            view.quietEnd == null ? "" : formatClockMinutes(view.quietEnd),
          scoringWeights: view.scoringWeights,
        }}
      />

      <section
        aria-labelledby="settings-rules"
        className="settings-section"
      >
        <h2 id="settings-rules">{AUTOMATION_RULES_TITLE}</h2>
        <AutomationRulesPanel rules={listAutomationRules(database, tenant)} />
      </section>

      <section
        aria-labelledby="settings-gmail"
        className="settings-section settings-section--slot"
      >
        <h2 id="settings-gmail">Gmail</h2>
        <GmailAccountsPanel
          accounts={gmailAccounts}
          configured={gmailAvailability.configured}
          missing={gmailAvailability.missing}
        />
      </section>

      <ExportPanel />
    </section>
  );
}
