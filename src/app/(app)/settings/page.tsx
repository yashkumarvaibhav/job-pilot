import { AutomationRulesPanel } from "@/components/automation-rules-panel";
import { ExportPanel } from "@/components/export-panel";
import { SettingsForm } from "@/components/settings-form";
import { AUTOMATION_RULES_TITLE } from "@/domain/rules";
import {
  formatClockMinutes,
  GMAIL_NOT_CONNECTED_HELP,
  GMAIL_NOT_CONNECTED_TITLE,
  quietHoursStateLine,
  selectableTimeZones,
} from "@/domain/settings";
import { requireTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readGmailOAuthAvailability } from "@/server/mail/google-config";
import { readWorkspaceSettings } from "@/server/repos/settings";
import { listAutomationRules } from "@/server/repos/rules";

export default async function SettingsPage() {
  const tenant = await requireTenant();
  const database = getDatabase();
  const view = readWorkspaceSettings(database, tenant);
  const gmailAvailability = readGmailOAuthAvailability();
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
        <div className="data-state data-state--empty" role="status">
          <p className="chip settings-chip settings-chip--pilot">
            <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
              <path
                d="M9 3h6M10 3v5l-4.5 8.2A3.2 3.2 0 0 0 8.3 21h7.4a3.2 3.2 0 0 0 2.8-4.8L14 8V3M8 15h8"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
            Limited pilot
          </p>
          <h3>{GMAIL_NOT_CONNECTED_TITLE}</h3>
          <p>{GMAIL_NOT_CONNECTED_HELP}</p>
          {gmailAvailability.configured ? (
            <a className="btn" href="/api/gmail/connect">
              Add Gmail account
            </a>
          ) : (
            <>
              <p className="settings-help">
                OAuth configuration is missing: {gmailAvailability.missing.join(", ")}.
              </p>
              <button className="btn btn--ghost" disabled type="button">
                Add Gmail account
              </button>
            </>
          )}
        </div>
      </section>

      <ExportPanel />
    </section>
  );
}
