"use client";

import { SETTINGS_ERROR } from "@/domain/settings";

export default function SettingsError({ reset }: { reset: () => void }) {
  return (
    <section className="data-state data-state--error">
      <p className="eyebrow">Could not load</p>
      <h1>Settings are unavailable</h1>
      <p>{SETTINGS_ERROR}</p>
      <button className="btn btn--ghost" onClick={reset} type="button">
        Retry
      </button>
    </section>
  );
}
