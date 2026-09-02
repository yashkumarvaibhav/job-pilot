import {
  EXPORT_ACTIVITY_CSV_LABEL,
  EXPORT_APPLICATIONS_CSV_LABEL,
  EXPORT_CONTACTS_CSV_LABEL,
  EXPORT_HELP,
  EXPORT_JOBS_CSV_LABEL,
  EXPORT_JSON_LABEL,
} from "@/domain/export";

const downloads = [
  {
    href: "/api/export?format=json&set=all",
    filename: "job-pilot.json",
    label: EXPORT_JSON_LABEL,
    primary: true,
  },
  {
    href: "/api/export?format=csv&set=jobs",
    filename: "job-pilot-jobs.csv",
    label: EXPORT_JOBS_CSV_LABEL,
    primary: false,
  },
  {
    href: "/api/export?format=csv&set=contacts",
    filename: "job-pilot-contacts.csv",
    label: EXPORT_CONTACTS_CSV_LABEL,
    primary: false,
  },
  {
    href: "/api/export?format=csv&set=applications",
    filename: "job-pilot-applications.csv",
    label: EXPORT_APPLICATIONS_CSV_LABEL,
    primary: false,
  },
  {
    href: "/api/export?format=csv&set=activity",
    filename: "job-pilot-activity.csv",
    label: EXPORT_ACTIVITY_CSV_LABEL,
    primary: false,
  },
] as const;

export function ExportPanel() {
  return (
    <section
      aria-labelledby="settings-export"
      className="settings-section"
    >
      <h2 id="settings-export">Export</h2>
      <p className="settings-help">{EXPORT_HELP}</p>
      <div className="settings-export-actions">
        {downloads.map((item) => (
          <a
            className={item.primary ? "btn" : "btn btn--ghost"}
            download={item.filename}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </a>
        ))}
      </div>
    </section>
  );
}
