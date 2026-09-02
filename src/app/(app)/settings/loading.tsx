import { SETTINGS_LOADING } from "@/domain/settings";

export default function SettingsLoading() {
  return (
    <section aria-label={SETTINGS_LOADING} className="settings-screen">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton-table">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="skeleton skeleton-row" key={index} />
        ))}
      </div>
    </section>
  );
}
