"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  DOCUMENT_EMPTY,
  DOCUMENT_KINDS,
  documentKindLabel,
  documentVersionLabel,
  suggestedVersionLabel,
} from "@/domain/document";

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export type DocumentVersionView = {
  id: string;
  label: string;
  size: string;
  sha256: string;
  createdAt: string;
  usageCount: number;
  downloadUrl: string;
  originalFilename: string | null;
};

export type DocumentView = {
  id: string;
  name: string;
  kind: string;
  versions: DocumentVersionView[];
};

function FileIcon() {
  return (
    <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function NewDocumentForm() {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name") ?? ""),
          kind: String(form.get("kind") ?? "resume"),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not create this document."));
        return;
      }
      formEl.reset();
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="document-new-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${formId}-name`}>Document name</label>
        <input
          disabled={pending}
          id={`${formId}-name`}
          name="name"
          placeholder="Backend Java"
          required
          type="text"
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-kind`}>Type</label>
        <select disabled={pending} id={`${formId}-kind`} name="kind">
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </div>
      <button className="btn" disabled={pending} type="submit">
        {pending ? "Adding…" : "Add document"}
      </button>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
    </form>
  );
}

function UploadVersionForm({ document }: { document: DocumentView }) {
  const formId = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const formEl = event.currentTarget;

    try {
      const response = await fetch(`/api/documents/${document.id}/versions`, {
        method: "POST",
        body: new FormData(formEl),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(body, "Could not upload this version."));
        return;
      }
      formEl.reset();
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form aria-busy={pending} className="document-upload-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${formId}-label`}>Version label</label>
        <input
          defaultValue={suggestedVersionLabel(
            document.versions.map((version) => version.label),
          )}
          disabled={pending}
          id={`${formId}-label`}
          name="label"
          required
          type="text"
        />
      </div>
      <div className="field">
        <label htmlFor={`${formId}-file`}>File</label>
        <input
          accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          disabled={pending}
          id={`${formId}-file`}
          name="file"
          required
          type="file"
        />
      </div>
      <button className="btn btn--ghost" disabled={pending} type="submit">
        {pending ? "Uploading…" : "Upload version"}
      </button>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
    </form>
  );
}

function DeleteVersionButton({
  version,
  documentName,
}: {
  version: DocumentVersionView;
  documentName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/document-versions/${version.id}`, {
        method: "DELETE",
      });
      if (response.status === 204) {
        router.refresh();
        return;
      }
      const body: unknown = await response.json();
      setMessage(responseError(body, "Could not delete this version."));
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        aria-label={`Delete ${documentVersionLabel(documentName, version.label)}`}
        className="btn btn--danger"
        disabled={pending}
        onClick={remove}
        type="button"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {message ? (
        <p className="form-alert" role="alert">
          <span aria-hidden="true">!</span>
          {message}
        </p>
      ) : null}
    </>
  );
}

export function DocumentManager({ documents }: { documents: DocumentView[] }) {
  return (
    <div className="document-manager">
      <section aria-labelledby="documents-new" className="settings-section">
        <h2 id="documents-new">Add a document</h2>
        <p className="settings-help">
          A document is the reusable thing — “Backend Java”. Each upload under it
          is one version.
        </p>
        <NewDocumentForm />
      </section>

      {documents.length === 0 ? (
        <div className="data-state data-state--empty" role="status">
          <p>{DOCUMENT_EMPTY}</p>
        </div>
      ) : (
        documents.map((row) => (
          <section
            aria-labelledby={`document-${row.id}`}
            className="settings-section"
            key={row.id}
          >
            <h2 id={`document-${row.id}`}>
              {row.name}{" "}
              <span className="document-kind">{documentKindLabel(row.kind)}</span>
            </h2>

            {row.versions.length === 0 ? (
              <p className="settings-hint">
                No versions yet. Upload the first file below.
              </p>
            ) : (
              <>
                <div className="table-scroll document-table-wrap">
                  <table className="tbl document-table">
                    <caption className="table-caption">
                      Stored versions of {row.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Size</th>
                        <th scope="col">Used by</th>
                        <th scope="col">File</th>
                        <th scope="col">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.versions.map((version) => (
                        <tr key={version.id}>
                          <th scope="row">
                            {documentVersionLabel(row.name, version.label)}
                          </th>
                          <td className="tnum">{version.size}</td>
                          <td className="tnum">
                            {version.usageCount === 0
                              ? "Not used"
                              : `${version.usageCount} application${
                                  version.usageCount === 1 ? "" : "s"
                                }`}
                          </td>
                          <td>
                            <a
                              className="document-download"
                              href={version.downloadUrl}
                            >
                              <FileIcon />
                              {version.originalFilename ?? "Download"}
                            </a>
                          </td>
                          <td>
                            <DeleteVersionButton
                              documentName={row.name}
                              version={version}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="document-card-list">
                  {row.versions.map((version) => (
                    <li className="document-card" key={version.id}>
                      <p className="document-card__name">
                        {documentVersionLabel(row.name, version.label)}
                      </p>
                      <p className="document-card__meta tnum">
                        {version.size} ·{" "}
                        {version.usageCount === 0
                          ? "Not used"
                          : `${version.usageCount} application${
                              version.usageCount === 1 ? "" : "s"
                            }`}
                      </p>
                      <a className="document-download" href={version.downloadUrl}>
                        <FileIcon />
                        {version.originalFilename ?? "Download"}
                      </a>
                      <DeleteVersionButton
                        documentName={row.name}
                        version={version}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}
            <UploadVersionForm document={row} />
          </section>
        ))
      )}
    </div>
  );
}
