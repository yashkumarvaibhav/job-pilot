"use client";

import { useEffect, useId, useState } from "react";

import { CsvImportError, parseCsv } from "@/domain/csv-import";

type EntitySet = "companies" | "contacts" | "opportunities";
type Mapping = Record<string, string>;
type ReportRow = {
  line: number;
  status:
    | "would-create"
    | "would-warn"
    | "would-skip"
    | "created"
    | "created-with-warning"
    | "skipped";
  reason: string;
  candidates?: Array<{
    id: string;
    label: string;
    href: string;
    signals: string[];
  }>;
};
type Report = {
  entitySet: EntitySet;
  dryRun: boolean;
  duplicateCheck: string;
  summary: Record<string, number>;
  rows: ReportRow[];
};

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const ENTITY_OPTIONS: Array<{ value: EntitySet; label: string }> = [
  { value: "companies", label: "Companies" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
];
const FIELD_CONFIG: Record<
  EntitySet,
  Array<{ value: string; label: string; required?: boolean }>
> = {
  companies: [
    { value: "name", label: "Company name", required: true },
    { value: "website", label: "Website" },
    { value: "careersUrl", label: "Careers URL" },
    { value: "industry", label: "Industry" },
    { value: "type", label: "Company type" },
    { value: "locations", label: "Locations" },
    { value: "target", label: "Target company" },
    { value: "notes", label: "Notes" },
  ],
  contacts: [
    { value: "name", label: "Contact name", required: true },
    { value: "company", label: "Company" },
    { value: "designation", label: "Designation" },
    { value: "email", label: "Email" },
    { value: "relationship", label: "Relationship" },
    { value: "source", label: "Source" },
    { value: "location", label: "Location" },
    { value: "notes", label: "Notes" },
    { value: "networkingStatus", label: "Networking status" },
    { value: "nextAction", label: "Next action" },
    { value: "followUpOn", label: "Follow-up date" },
  ],
  opportunities: [
    { value: "company", label: "Company", required: true },
    { value: "role", label: "Role", required: true },
    { value: "jobId", label: "Job ID" },
    { value: "url", label: "Job URL" },
    { value: "location", label: "Location" },
    { value: "workMode", label: "Work mode" },
    { value: "employmentType", label: "Employment type" },
    { value: "experienceRequirement", label: "Experience requirement" },
    { value: "source", label: "Source" },
    { value: "discoveredOn", label: "Date discovered" },
    { value: "postedOn", label: "Posting date" },
    { value: "deadlineOn", label: "Deadline" },
    { value: "compensation", label: "Compensation" },
    { value: "priority", label: "Priority" },
    { value: "interestScore", label: "Interest score" },
    { value: "eligibility", label: "Eligibility" },
    { value: "referralPreferred", label: "Referral preferred" },
    { value: "jdSnapshot", label: "JD snapshot" },
    { value: "notes", label: "Notes" },
    { value: "bucket", label: "Bucket" },
    { value: "stage", label: "Stage" },
    { value: "nextAction", label: "Next action" },
  ],
};

function messageFrom(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function isReport(value: unknown): value is Report {
  return (
    typeof value === "object" &&
    value !== null &&
    "rows" in value &&
    Array.isArray((value as { rows: unknown }).rows) &&
    "summary" in value
  );
}

function statusLabel(status: ReportRow["status"]) {
  return status
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function statusSymbol(status: ReportRow["status"]) {
  if (status === "created" || status === "would-create") return "+";
  if (status === "created-with-warning" || status === "would-warn") return "!";
  return "−";
}

const SUMMARY_LABELS: Record<string, string> = {
  wouldCreate: "Would create",
  wouldWarn: "Would warn",
  wouldSkip: "Would skip",
  created: "Created",
  warned: "Warned",
  skipped: "Skipped",
};

export function ImportDisabledNotice() {
  return (
    <section className="import-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>CSV import</h1>
          <p className="page-lede">
            Bring companies, contacts, and saved jobs into your private workspace.
          </p>
        </div>
      </header>
      <div className="data-state data-state--warning" role="status">
        <h2>Import is disabled in the public demo</h2>
        <p>
          This synthetic workspace cannot accept private files. Import remains
          available in a normal private Job Pilot workspace.
        </p>
      </div>
    </section>
  );
}

export function ImportWorkspace() {
  const controlId = useId();
  const [entitySet, setEntitySet] = useState<EntitySet>("companies");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [createMissingCompanies, setCreateMissingCompanies] = useState(true);
  const [report, setReport] = useState<Report | null>(null);
  const [overrideLines, setOverrideLines] = useState<number[]>([]);
  const [pending, setPending] = useState(false);
  const [loadingMapping, setLoadingMapping] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetch(`/api/import?entitySet=${entitySet}`)
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(messageFrom(body, "Could not load the saved mapping."));
        return body;
      })
      .then((body) => {
        if (
          current &&
          typeof body === "object" &&
          body !== null &&
          "mapping" in body &&
          typeof (body as { mapping: unknown }).mapping === "object"
        ) {
          setMapping((body as { mapping: Mapping }).mapping);
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setMapping({});
          setMessage(error instanceof Error ? error.message : "Could not reach Job Pilot.");
        }
      })
      .finally(() => {
        if (current) setLoadingMapping(false);
      });
    return () => {
      current = false;
    };
  }, [entitySet]);

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setReport(null);
    setOverrideLines([]);
    setMessage(null);
    if (!file) {
      setFileName("");
      setCsv("");
      setHeaders([]);
      return;
    }
    if (file.size > MAX_CSV_BYTES) {
      setMessage("Choose a CSV file no larger than 2 MB.");
      event.target.value = "";
      return;
    }
    try {
      const contents = await file.text();
      const document = parseCsv(contents);
      setFileName(file.name);
      setCsv(contents);
      setHeaders(document.headers);
      setMapping((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, header]) =>
            document.headers.includes(header),
          ),
        ),
      );
    } catch (error) {
      setFileName("");
      setCsv("");
      setHeaders([]);
      setMessage(
        error instanceof CsvImportError
          ? error.message
          : "Could not read that CSV file.",
      );
    }
  }

  function changeMapping(field: string, header: string) {
    setMapping((current) => {
      const next = { ...current };
      if (header) {
        for (const [otherField, otherHeader] of Object.entries(next)) {
          if (otherField !== field && otherHeader === header) delete next[otherField];
        }
        next[field] = header;
      }
      else delete next[field];
      return next;
    });
    setReport(null);
    setOverrideLines([]);
  }

  const requiredReady = FIELD_CONFIG[entitySet]
    .filter((field) => field.required)
    .every(
      (field) =>
        mapping[field.value] && headers.includes(mapping[field.value]),
    );
  const canPreview =
    csv.length > 0 && requiredReady && !pending && !loadingMapping;
  const showOverrideColumn =
    report?.dryRun === true &&
    report.rows.some((row) => (row.candidates?.length ?? 0) > 0);

  async function requestReport(dryRun: boolean) {
    setPending(true);
    setMessage(null);
    try {
      if (dryRun) {
        const saveResponse = await fetch("/api/import", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entitySet, mapping }),
        });
        const saved: unknown = await saveResponse.json();
        if (!saveResponse.ok) {
          setMessage(messageFrom(saved, "Could not remember the column mapping."));
          return;
        }
      }
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entitySet,
          dryRun,
          csv,
          mapping,
          createMissingCompanies,
          ...(dryRun ? {} : { overrideLines }),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isReport(body)) {
        setMessage(messageFrom(body, "Could not run the import. Check the mapping and retry."));
        return;
      }
      setReport(body);
      if (dryRun) setOverrideLines([]);
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="import-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>CSV import</h1>
          <p className="page-lede">
            Review every row before anything enters your private workspace.
          </p>
        </div>
      </header>

      <div className="card import-setup-card">
        <div className="field">
          <label htmlFor={`${controlId}-entity`}>What are you importing?</label>
          <select
            disabled={pending}
            id={`${controlId}-entity`}
            onChange={(event) => {
              setEntitySet(event.target.value as EntitySet);
              setLoadingMapping(true);
              setMapping({});
              setReport(null);
              setOverrideLines([]);
              setMessage(null);
            }}
            value={entitySet}
          >
            {ENTITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${controlId}-file`}>Choose CSV file</label>
          <input
            accept=".csv,text/csv"
            disabled={pending}
            id={`${controlId}-file`}
            onChange={chooseFile}
            type="file"
          />
          <p className="field-hint">
            {fileName || "Choose a CSV to begin. CSV only, up to 2 MB."}
          </p>
        </div>
        {entitySet !== "companies" ? (
          <label className="checkbox-field">
            <input
              checked={createMissingCompanies}
              disabled={pending}
              onChange={(event) => {
                setCreateMissingCompanies(event.target.checked);
                setReport(null);
                setOverrideLines([]);
              }}
              type="checkbox"
            />
            <span>Create companies that are named in the CSV but not found</span>
          </label>
        ) : null}
      </div>

      <section aria-labelledby={`${controlId}-mapping-title`} className="import-section">
        <div>
          <p className="eyebrow">Required review</p>
          <h2 id={`${controlId}-mapping-title`}>Map CSV columns</h2>
          <p className="page-lede">
            Job Pilot never guesses. Pick each destination explicitly; required fields are marked.
          </p>
        </div>
        <div className="table-scroll import-mapping-wrap">
          <table className="tbl import-mapping-table">
            <thead>
              <tr>
                <th scope="col">Job Pilot field</th>
                <th scope="col">CSV column</th>
              </tr>
            </thead>
            <tbody>
              {FIELD_CONFIG[entitySet].map((field) => (
                <tr key={field.value}>
                  <th data-label="Job Pilot field" scope="row">
                    {field.label}
                    {field.required ? <span aria-label="required"> *</span> : null}
                  </th>
                  <td data-label="CSV column">
                    <label className="sr-only" htmlFor={`${controlId}-${field.value}`}>
                      CSV column for {field.label}
                    </label>
                    <select
                      disabled={pending || loadingMapping || headers.length === 0}
                      id={`${controlId}-${field.value}`}
                      onChange={(event) => changeMapping(field.value, event.target.value)}
                      value={headers.includes(mapping[field.value]) ? mapping[field.value] : ""}
                    >
                      <option value="">Do not import</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="import-actions">
        <button
          className="btn btn--ghost"
          disabled={!canPreview}
          onClick={() => requestReport(true)}
          type="button"
        >
          {pending ? "Working…" : "Dry run"}
        </button>
        <button
          className="btn"
          disabled={pending || report?.dryRun !== true}
          onClick={() => requestReport(false)}
          type="button"
        >
          Apply import
        </button>
      </div>

      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}

      <section aria-labelledby={`${controlId}-report-title`} className="import-section" aria-live="polite">
        <div>
          <p className="eyebrow">Row-by-row proof</p>
          <h2 id={`${controlId}-report-title`}>Import report</h2>
        </div>
        {!report ? (
          <div className="data-state data-state--empty">
            <p>Choose a file, map its columns, then run a dry run to see every row here.</p>
          </div>
        ) : (
          <>
            <div className="import-summary">
              {Object.entries(report.summary).map(([label, count]) => (
                <div key={label}>
                  <span className="eyebrow">{SUMMARY_LABELS[label] ?? label}</span>
                  <strong className="tnum">{count}</strong>
                </div>
              ))}
            </div>
            <p className="import-duplicate-note">Duplicate check: {report.duplicateCheck}</p>
            <div className="table-scroll import-report-wrap">
              <table className="tbl import-report-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Result</th>
                    <th scope="col">Reason</th>
                    {showOverrideColumn ? <th scope="col">Override</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={`${row.line}-${row.status}`}>
                      <td className="tnum" data-label="Line">{row.line}</td>
                      <td data-label="Result">
                        <span className="chip import-status" data-status={row.status}>
                          <span aria-hidden="true">{statusSymbol(row.status)}</span>
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td data-label="Reason">{row.reason}</td>
                      {showOverrideColumn ? (
                        <td data-label="Override">
                          {(row.candidates?.length ?? 0) > 0 ? (
                            <label className="checkbox-field import-override">
                              <input
                                checked={overrideLines.includes(row.line)}
                                disabled={pending}
                                onChange={(event) => {
                                  setOverrideLines((current) =>
                                    event.target.checked
                                      ? [...current, row.line]
                                      : current.filter((line) => line !== row.line),
                                  );
                                }}
                                type="checkbox"
                              />
                              <span>Create anyway</span>
                            </label>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
