"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Inbox,
  Link2,
  Mail,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

import { REPLY_CLASSIFICATIONS } from "@/domain/reply-classification";
import { QuickAddDialog } from "./quick-add-dialog";

export type InboxAccount = {
  id: string;
  email: string;
  status: "connected" | "disconnected" | "error";
  lastSyncAt: string | null;
  sequenceSafeAt: string | null;
  lastSyncError: string | null;
};

export type InboxContact = {
  id: string;
  name: string;
  companyName: string | null;
};

type InboxMessage = {
  id: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  to: string[];
  subject: string;
  body: string;
  sentAt: string;
  classification: string | null;
};

export type InboxThread = {
  id: string;
  accountId: string;
  accountEmail: string;
  accountStatus: InboxAccount["status"];
  counterpartEmail: string;
  subject: string;
  contactId: string | null;
  linkedLabel: string;
  matchStatus: "unmatched" | "automatic" | "suggested" | "manual";
  matchReason: string | null;
  suggestedContacts: { id: string; name: string }[];
  lastMessageAt: string;
  messages: InboxMessage[];
};

type SearchPreview = {
  gmailThreadId: string;
  subject: string;
  counterpartEmail: string;
  lastMessageAt: string;
  messages: Array<{
    gmailId: string;
    fromEmail: string;
    to: string[];
    subject: string;
    body: string;
    sentAt: string;
  }>;
};

function displayDate(value: string | null): string {
  if (!value) return "Not synced yet";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

function MatchBadge({ thread }: { thread: InboxThread }) {
  if (thread.matchStatus === "suggested") {
    return (
      <span className="chip inbox-match inbox-match--suggested">
        <AlertTriangle aria-hidden="true" /> Suggested match
      </span>
    );
  }
  if (thread.matchStatus === "unmatched") {
    return (
      <span className="chip inbox-match inbox-match--unmatched">
        <AlertTriangle aria-hidden="true" /> Unmatched
      </span>
    );
  }
  return (
    <span className="chip inbox-match inbox-match--matched">
      <CheckCircle2 aria-hidden="true" />
      {thread.matchStatus === "manual" ? "Linked manually" : "Matched automatically"}
    </span>
  );
}

export function InboxWorkspace({
  accounts,
  contacts,
  gmailConfigured,
  threads,
}: {
  accounts: InboxAccount[];
  contacts: InboxContact[];
  gmailConfigured: boolean;
  threads: InboxThread[];
}) {
  const router = useRouter();
  const connected = accounts.filter((account) => account.status === "connected");
  const [accountFilter, setAccountFilter] = useState("all");
  const [selectedThreadId, setSelectedThreadId] = useState(threads[0]?.id ?? "");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [returnFocusTo, setReturnFocusTo] = useState<HTMLElement | null>(null);
  const [importAccountId, setImportAccountId] = useState(connected[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchPreview[]>([]);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [importContactId, setImportContactId] = useState("");
  const [importing, setImporting] = useState(false);
  const [relinkContactId, setRelinkContactId] = useState("");
  const [classification, setClassification] = useState("");
  const [threadPending, setThreadPending] = useState(false);

  const closeImport = useCallback(() => setImportOpen(false), []);
  const filteredThreads = useMemo(
    () =>
      accountFilter === "all"
        ? threads
        : threads.filter((thread) => thread.accountId === accountFilter),
    [accountFilter, threads],
  );
  const selectedThread =
    filteredThreads.find((thread) => thread.id === selectedThreadId) ??
    filteredThreads[0];
  const selectedResult = results.find(
    (result) => result.gmailThreadId === selectedResultId,
  );

  async function sync() {
    const targets =
      accountFilter === "all"
        ? connected
        : connected.filter((account) => account.id === accountFilter);
    if (!gmailConfigured || targets.length === 0) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    const failures: string[] = [];
    await Promise.all(
      targets.map(async (account) => {
        try {
          const response = await fetch(
            `/api/gmail/${encodeURIComponent(account.id)}/sync`,
            { method: "POST" },
          );
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            failures.push(`${account.email}: ${responseError(body, "Sync failed.")}`);
          }
        } catch {
          failures.push(`${account.email}: Job Pilot could not reach Gmail.`);
        }
      }),
    );
    setSyncing(false);
    if (failures.length > 0) setError(failures.join(" "));
    else setNotice(`Synced ${targets.length} Gmail ${targets.length === 1 ? "account" : "accounts"}.`);
    router.refresh();
  }

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearching(true);
    setError(null);
    setResults([]);
    setSelectedResultId("");
    try {
      const response = await fetch("/api/inbox/import/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: importAccountId, query }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Gmail search failed."));
        return;
      }
      const nextResults =
        typeof body === "object" &&
        body !== null &&
        "results" in body &&
        Array.isArray((body as { results: unknown }).results)
          ? ((body as { results: SearchPreview[] }).results ?? [])
          : [];
      setResults(nextResults);
      setSelectedResultId(nextResults[0]?.gmailThreadId ?? "");
    } catch {
      setError("Job Pilot could not reach Gmail search.");
    } finally {
      setSearching(false);
    }
  }

  async function importThread() {
    if (!selectedResult) return;
    setImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: importAccountId,
          gmailThreadId: selectedResult.gmailThreadId,
          contactId: importContactId || null,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Gmail thread import failed."));
        return;
      }
      setNotice(
        importContactId
          ? "Thread imported and linked."
          : "Thread imported as Unmatched.",
      );
      setImportOpen(false);
      router.refresh();
    } catch {
      setError("Job Pilot could not import this Gmail thread.");
    } finally {
      setImporting(false);
    }
  }

  async function threadAction(
    path: string,
    payload: Record<string, string>,
    success: string,
  ) {
    setThreadPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(responseError(body, "Inbox update failed."));
        return;
      }
      setNotice(success);
      router.refresh();
    } catch {
      setError("Job Pilot could not update this Inbox thread.");
    } finally {
      setThreadPending(false);
    }
  }

  return (
    <article className="inbox-page" data-density="compact">
      <header className="page-header inbox-header">
        <div>
          <p className="eyebrow">Gmail</p>
          <h1>Job Inbox</h1>
          <p className="page-lede">
            Recruiting conversations from every connected account, with explicit CRM links.
          </p>
        </div>
        <div className="inbox-header__actions">
          <label className="field inbox-account-filter" htmlFor="inbox-account-filter">
            <span>Mailbox</span>
            <select
              id="inbox-account-filter"
              onChange={(event) => setAccountFilter(event.target.value)}
              value={accountFilter}
            >
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.email}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn--ghost"
            disabled={!gmailConfigured || connected.length === 0 || syncing}
            onClick={sync}
            type="button"
          >
            <RefreshCw aria-hidden="true" /> {syncing ? "Syncing…" : "Sync"}
          </button>
          <button
            aria-haspopup="dialog"
            className="btn"
            disabled={!gmailConfigured || connected.length === 0}
            onClick={(event) => {
              setReturnFocusTo(event.currentTarget);
              setImportOpen(true);
            }}
            type="button"
          >
            <Download aria-hidden="true" /> Import Gmail thread
          </button>
        </div>
      </header>

      {!gmailConfigured && accounts.length > 0 ? (
        <div className="inbox-banner inbox-banner--warning" role="status">
          <AlertTriangle aria-hidden="true" />
          Gmail is disconnected at the server. Add the Google client values to enable Sync and Import.
        </div>
      ) : null}
      {accounts.filter((account) => account.status !== "connected").map((account) => (
        <div className="inbox-banner inbox-banner--danger" key={account.id} role="status">
          <AlertTriangle aria-hidden="true" />
          {account.email} is disconnected. Its saved threads remain visible; reconnect it in Settings to sync.
        </div>
      ))}
      {error ? (
        <div className="inbox-banner inbox-banner--danger" role="alert">
          <AlertTriangle aria-hidden="true" /> {error}
        </div>
      ) : null}
      {notice ? (
        <div className="inbox-banner inbox-banner--success" role="status">
          <CheckCircle2 aria-hidden="true" /> {notice}
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <section aria-label="Gmail account sync status" className="inbox-account-strip">
          {accounts.map((account) => (
            <article className="inbox-account-status" key={account.id}>
              <div>
                <Mail aria-hidden="true" />
                <strong>{account.email}</strong>
              </div>
              <p>Inbox: {displayDate(account.lastSyncAt)}</p>
              {account.sequenceSafeAt !== account.lastSyncAt && account.lastSyncAt ? (
                <p className="inbox-safety-note">
                  <AlertTriangle aria-hidden="true" /> Sequence safety is still reconciling.
                </p>
              ) : null}
              {account.lastSyncError ? <p className="inbox-sync-error">{account.lastSyncError}</p> : null}
            </article>
          ))}
        </section>
      ) : null}

      {accounts.length === 0 ? (
        <section className="data-state data-state--empty">
          <Inbox aria-hidden="true" />
          <h2>Connect Gmail in Settings to pull recruiting threads.</h2>
          <a className="btn" href="/settings">Open Gmail settings</a>
        </section>
      ) : filteredThreads.length === 0 ? (
        <section className="data-state data-state--empty">
          <Inbox aria-hidden="true" />
          <h2>No recruiting threads matched yet.</h2>
          <p>Sync or import any Gmail thread.</p>
        </section>
      ) : (
        <section className="inbox-shell" aria-label="Job Inbox threads">
          <div className="inbox-thread-list" role="list">
            <div className="inbox-thread-list__heading">
              <strong>{filteredThreads.length} threads</strong>
              <span>Newest first</span>
            </div>
            {filteredThreads.map((thread) => (
              <button
                aria-current={selectedThread?.id === thread.id ? "true" : undefined}
                className="inbox-thread-row"
                key={thread.id}
                onClick={() => {
                  setSelectedThreadId(thread.id);
                  setRelinkContactId("");
                  setClassification("");
                }}
                role="listitem"
                type="button"
              >
                <span className="inbox-thread-row__topline">
                  <strong>{thread.counterpartEmail}</strong>
                  <time dateTime={thread.lastMessageAt}>{displayDate(thread.lastMessageAt)}</time>
                </span>
                <span className="inbox-thread-row__subject">{thread.subject}</span>
                <span className="inbox-thread-row__meta">
                  {thread.linkedLabel} · {thread.accountEmail}
                </span>
              </button>
            ))}
          </div>

          {selectedThread ? (
            <article className="inbox-thread-pane">
              <header className="inbox-thread-pane__header">
                <div>
                  <p className="eyebrow">{selectedThread.accountEmail}</p>
                  <h2>{selectedThread.subject}</h2>
                  <p>{selectedThread.counterpartEmail}</p>
                </div>
                <MatchBadge thread={selectedThread} />
              </header>
              {selectedThread.matchReason ? (
                <p className="inbox-match-reason">{selectedThread.matchReason}</p>
              ) : null}
              {selectedThread.matchStatus === "suggested" ? (
                <section className="inbox-suggestions" aria-label="Suggested matches">
                  <p>Confirming is the first action that changes the CRM link.</p>
                  <div>
                    {selectedThread.suggestedContacts.map((candidate) => (
                      <button
                        className="btn btn--ghost"
                        disabled={threadPending}
                        key={candidate.id}
                        onClick={() =>
                          threadAction(
                            `/api/inbox/${encodeURIComponent(selectedThread.id)}/confirm-match`,
                            { contactId: candidate.id },
                            `Linked to ${candidate.name}.`,
                          )
                        }
                        type="button"
                      >
                        <CheckCircle2 aria-hidden="true" /> Confirm {candidate.name}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="inbox-message-stack">
                {selectedThread.messages.map((message) => (
                  <article className="inbox-message" key={message.id}>
                    <header>
                      <div>
                        <strong>{message.fromEmail}</strong>
                        <span>to {message.to.join(", ")}</span>
                      </div>
                      <time dateTime={message.sentAt}>{displayDate(message.sentAt)}</time>
                    </header>
                    <pre>{message.body || "No plain-text body was available."}</pre>
                    {message.classification ? (
                      <span className="chip inbox-message__classification">
                        <Tag aria-hidden="true" />
                        {REPLY_CLASSIFICATIONS.find((item) => item.value === message.classification)?.label ?? message.classification}
                      </span>
                    ) : null}
                  </article>
                ))}
              </div>

              <footer className="inbox-thread-actions">
                <div className="field inbox-thread-action">
                  <label htmlFor="inbox-relink">Relink to contact</label>
                  <div>
                    <select
                      id="inbox-relink"
                      onChange={(event) => setRelinkContactId(event.target.value)}
                      value={relinkContactId}
                    >
                      <option value="">Choose contact</option>
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}{contact.companyName ? ` — ${contact.companyName}` : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn--ghost"
                      disabled={!relinkContactId || threadPending}
                      onClick={() =>
                        threadAction(
                          `/api/inbox/${encodeURIComponent(selectedThread.id)}/relink`,
                          { contactId: relinkContactId },
                          "Thread relinked and timeline updated.",
                        )
                      }
                      type="button"
                    >
                      <Link2 aria-hidden="true" /> Relink
                    </button>
                  </div>
                </div>
                <div className="field inbox-thread-action">
                  <label htmlFor="inbox-classify">Classify reply</label>
                  <div>
                    <select
                      disabled={selectedThread.matchStatus === "unmatched"}
                      id="inbox-classify"
                      onChange={(event) => setClassification(event.target.value)}
                      value={classification}
                    >
                      <option value="">Choose label</option>
                      {REPLY_CLASSIFICATIONS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                    <button
                      className="btn"
                      disabled={!classification || selectedThread.matchStatus === "unmatched" || threadPending}
                      onClick={() =>
                        threadAction(
                          `/api/inbox/${encodeURIComponent(selectedThread.id)}/classify`,
                          { classification },
                          "Reply classification saved.",
                        )
                      }
                      type="button"
                    >
                      <Tag aria-hidden="true" /> Classify
                    </button>
                  </div>
                </div>
              </footer>
            </article>
          ) : null}
        </section>
      )}

      {importOpen ? (
        <QuickAddDialog
          onClose={closeImport}
          returnFocusTo={returnFocusTo}
          title="Import Gmail thread"
        >
          <div className="inbox-import">
            <form className="inbox-import__search" onSubmit={search}>
              <div className="field">
                <label htmlFor="import-account">Gmail account</label>
                <select
                  id="import-account"
                  onChange={(event) => {
                    setImportAccountId(event.target.value);
                    setResults([]);
                    setSelectedResultId("");
                  }}
                  value={importAccountId}
                >
                  {connected.map((account) => (
                    <option key={account.id} value={account.id}>{account.email}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="import-query">Gmail search query</label>
                <input
                  data-dialog-initial-focus
                  id="import-query"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="from:recruiter@example.com"
                  required
                  value={query}
                />
              </div>
              <button className="btn" disabled={searching} type="submit">
                <Search aria-hidden="true" /> {searching ? "Searching…" : "Search Gmail"}
              </button>
            </form>

            {results.length > 0 ? (
              <div className="inbox-import__results">
                <div aria-label="Gmail search results" className="inbox-import__choices" role="list">
                  {results.map((result) => (
                    <button
                      aria-current={selectedResultId === result.gmailThreadId ? "true" : undefined}
                      key={result.gmailThreadId}
                      onClick={() => setSelectedResultId(result.gmailThreadId)}
                      role="listitem"
                      type="button"
                    >
                      <strong>{result.counterpartEmail}</strong>
                      <span>{result.subject}</span>
                      <time dateTime={result.lastMessageAt}>{displayDate(result.lastMessageAt)}</time>
                    </button>
                  ))}
                </div>
                {selectedResult ? (
                  <section className="inbox-import__preview" aria-label="Complete thread preview">
                    <h3>{selectedResult.subject}</h3>
                    {selectedResult.messages.map((message) => (
                      <article key={message.gmailId}>
                        <strong>{message.fromEmail}</strong>
                        <time dateTime={message.sentAt}>{displayDate(message.sentAt)}</time>
                        <pre>{message.body || "No plain-text body was available."}</pre>
                      </article>
                    ))}
                    <div className="field">
                      <label htmlFor="import-contact">CRM link (optional)</label>
                      <select
                        id="import-contact"
                        onChange={(event) => setImportContactId(event.target.value)}
                        value={importContactId}
                      >
                        <option value="">Import as Unmatched</option>
                        {contacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.name}{contact.companyName ? ` — ${contact.companyName}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button className="btn" disabled={importing} onClick={importThread} type="button">
                      <Download aria-hidden="true" /> {importing ? "Importing…" : "Import selected thread"}
                    </button>
                  </section>
                ) : null}
              </div>
            ) : query && !searching ? (
              <p className="inbox-import__empty">No results loaded. Run the Gmail search.</p>
            ) : null}
          </div>
        </QuickAddDialog>
      ) : null}
    </article>
  );
}
