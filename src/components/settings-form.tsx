"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  QUIET_HOURS_HELP,
  SETTINGS_PROFILE_MAX,
  TIMEZONE_HELP,
} from "@/domain/settings";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export type SettingsFormValues = {
  displayName: string;
  university: string;
  timezone: string;
  quietStart: string;
  quietEnd: string;
};

export function SettingsForm({
  quietState,
  timeZones,
  values,
}: {
  quietState: { active: boolean; label: string; sentence: string };
  timeZones: readonly string[];
  values: SettingsFormValues;
}) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [timezone, setTimezone] = useState(values.timezone);
  const zoneListId = `${formId}-zones`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);

    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: String(form.get("displayName") ?? ""),
      university: String(form.get("university") ?? ""),
      timezone: String(form.get("timezone") ?? ""),
      quietStart: String(form.get("quietStart") ?? ""),
      quietEnd: String(form.get("quietEnd") ?? ""),
    };

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body, "Could not save these settings."));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="settings-form" onSubmit={submit}>
      <section aria-labelledby={`${formId}-profile`} className="settings-section">
        <h2 id={`${formId}-profile`}>Profile</h2>
        <p className="settings-help">
          Templates read these as <code>{"{{my_name}}"}</code> and{" "}
          <code>{"{{my_university}}"}</code>.
        </p>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor={`${formId}-name`}>Display name</label>
            <input
              defaultValue={values.displayName}
              disabled={pending}
              id={`${formId}-name`}
              maxLength={SETTINGS_PROFILE_MAX}
              name="displayName"
              required
              type="text"
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-university`}>University</label>
            <input
              defaultValue={values.university}
              disabled={pending}
              id={`${formId}-university`}
              maxLength={SETTINGS_PROFILE_MAX}
              name="university"
              type="text"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby={`${formId}-zone`} className="settings-section">
        <h2 id={`${formId}-zone`}>Timezone</h2>
        <p className="settings-help">{TIMEZONE_HELP}</p>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor={`${formId}-timezone`}>IANA timezone</label>
            <input
              aria-describedby={`${formId}-zone-current`}
              disabled={pending}
              id={`${formId}-timezone`}
              list={zoneListId}
              name="timezone"
              onChange={(event) => setTimezone(event.currentTarget.value)}
              required
              type="text"
              value={timezone}
            />
            <datalist id={zoneListId}>
              {timeZones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <p className="settings-hint" id={`${formId}-zone-current`}>
              Today is currently read in <strong>{timezone}</strong>.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${formId}-quiet`} className="settings-section">
        <h2 id={`${formId}-quiet`}>Quiet hours</h2>
        <p className="settings-help">{QUIET_HOURS_HELP}</p>
        <div className="settings-grid">
          <div className="field">
            <label htmlFor={`${formId}-quiet-start`}>Start</label>
            <input
              className="tnum"
              defaultValue={values.quietStart}
              disabled={pending}
              id={`${formId}-quiet-start`}
              name="quietStart"
              type="time"
            />
          </div>
          <div className="field">
            <label htmlFor={`${formId}-quiet-end`}>End</label>
            <input
              className="tnum"
              defaultValue={values.quietEnd}
              disabled={pending}
              id={`${formId}-quiet-end`}
              name="quietEnd"
              type="time"
            />
          </div>
        </div>
        <p
          className={`chip settings-chip${
            quietState.active ? " settings-chip--quiet" : ""
          }`}
        >
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            {quietState.active ? (
              <path
                d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            ) : (
              <path
                d="M12 4v2m0 12v2m8-8h-2M6 12H4m13.7-5.7-1.4 1.4M7.7 16.3l-1.4 1.4m11.4 0-1.4-1.4M7.7 7.7 6.3 6.3M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            )}
          </svg>
          {quietState.label}
        </p>
        <p className="settings-hint">
          {quietState.sentence} Clear both fields to turn quiet hours off.
        </p>
      </section>

      {error ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      ) : null}
      <div className="settings-actions">
        <button className="btn" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save settings"}
        </button>
        <p aria-live="polite" className="settings-saved" role="status">
          {saved ? "Settings saved." : ""}
        </p>
      </div>
    </form>
  );
}
