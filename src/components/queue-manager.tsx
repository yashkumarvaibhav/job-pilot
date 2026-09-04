"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleX,
  Clock3,
  PauseCircle,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type QueueStatus =
  | "awaiting_approval"
  | "approved"
  | "claimed"
  | "sent"
  | "failed"
  | "held"
  | "cancelled";

export type QueueSummary = {
  id: string;
  accountEmail: string;
  contactName: string | null;
  origin: "one_off" | "sequence" | "self_digest";
  status: QueueStatus;
  subject: string;
  sendAt: string;
  sentAt: string | null;
  lastError: string | null;
};

export type QueueDetail = QueueSummary & {
  recipient: string;
  body: string;
  attachments: { id: string; name: string }[];
  deliveryUncertain: boolean;
  sendAnywayAvailable?: boolean;
};

export type QueueUsage = {
  id: string;
  email: string;
  sentToday: number;
  dailyLimit: number;
};

export type SuppressionListItem = {
  id: string;
  email: string;
  reason: string;
  at: string;
};

const tabs = [
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "approved", label: "Approved" },
  { value: "held", label: "Held" },
  { value: "sent", label: "Sent" },
] as const;

function statusLabel(status: QueueStatus): string {
  return status.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function StatusIcon({ status }: { status: QueueStatus }) {
  if (status === "sent") return <CheckCircle2 aria-hidden="true" />;
  if (status === "approved") return <Clock3 aria-hidden="true" />;
  if (status === "cancelled") return <CircleX aria-hidden="true" />;
  if (status === "held" || status === "failed" || status === "claimed") {
    return <ShieldAlert aria-hidden="true" />;
  }
  return <PauseCircle aria-hidden="true" />;
}

function queueTab(status: QueueStatus) {
  return status === "failed" || status === "claimed" ? "held" : status;
}

function responseError(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : "The queue could not be updated. Retry without changing the message.";
}

export function QueueManager({
  initialReviewId,
  items,
  suppression,
  timeZone,
  usage,
}: {
  initialReviewId?: string | null;
  items: QueueSummary[];
  suppression: SuppressionListItem[];
  timeZone: string;
  usage: QueueUsage[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]["value"]>(
    "awaiting_approval",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QueueDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pending, setPending] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [uncertainDeliveryAcknowledged, setUncertainDeliveryAcknowledged] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const openedReview = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
    }
  }, [selectedId]);

  async function openReview(id: string, trigger?: HTMLButtonElement) {
    opener.current = trigger ?? null;
    setSelectedId(id);
    setDetail(null);
    setLoadingDetail(true);
    setUncertainDeliveryAcknowledged(false);
    setError(null);
    try {
      const response = await fetch(`/api/queue/${encodeURIComponent(id)}`);
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body));
        return;
      }
      setDetail(body as QueueDetail);
      const loaded = body as QueueDetail;
      if (loaded.sendAt) {
        const stamp = new Date(loaded.sendAt);
        if (!Number.isNaN(stamp.valueOf())) {
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).formatToParts(stamp);
          const value = (type: Intl.DateTimeFormatPartTypes) =>
            parts.find((part) => part.type === type)?.value ?? "";
          setSendAt(
            `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`,
          );
        }
      }
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    if (!initialReviewId || openedReview.current === initialReviewId) return;
    openedReview.current = initialReviewId;
    void openReview(initialReviewId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once for ?review=
  }, [initialReviewId]);

  function closeReview() {
    if (dialog.current?.open) dialog.current.close();
    setSelectedId(null);
    setDetail(null);
    setSendAt("");
    setUncertainDeliveryAcknowledged(false);
    setError(null);
    opener.current?.focus();
    opener.current = null;
  }

  async function queueAction(
    path: string,
    options: RequestInit,
    success: string,
  ) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(path, options);
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body));
        return;
      }
      if (selectedId) closeReview();
      setMessage(success);
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  async function addSuppression(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/suppression", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(responseError(body));
        return;
      }
      event.currentTarget.reset();
      setMessage(`${email.trim().toLowerCase()} is suppressed.`);
      router.refresh();
    } catch {
      setError("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  const visible = items.filter(
    (item) => queueTab(item.status) === activeTab && item.status !== "cancelled",
  );
  const stuck = items.filter((item) => item.status === "claimed").length;

  return (
    <div className="queue-manager">
      <section aria-label="Account send usage" className="queue-usage">
        {usage.map((account) => (
          <article key={account.id}>
            <span>{account.email}</span>
            <strong className="tnum">
              {account.sentToday} / {account.dailyLimit} sent today
            </strong>
          </article>
        ))}
      </section>

      {stuck > 0 ? (
        <div className="queue-stuck" role="alert">
          <ShieldAlert aria-hidden="true" />
          <p>
            {stuck} delivery {stuck === 1 ? "claim needs" : "claims need"} review after an
            interrupted send. Job Pilot will not resend automatically.
          </p>
        </div>
      ) : null}

      {error && !selectedId ? (
        <p className="form-alert" role="alert">
          <AlertTriangle aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <p aria-live="polite" className="settings-saved" role="status">
        {message ?? ""}
      </p>

      <div aria-label="Queue status" className="queue-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.value}
            className="queue-tab"
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            role="tab"
            type="button"
          >
            {tab.label}
            <span className="tnum">
              {items.filter((item) => queueTab(item.status) === tab.value).length}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="data-state data-state--empty" role="status">
          <h2>Nothing queued.</h2>
          <p>This tab fills when an exact message reaches this state.</p>
        </div>
      ) : (
        <div className="table-scroll queue-table-wrap">
          <table className="data-table queue-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Contact</th>
                <th>Account</th>
                <th>Origin</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id}>
                  <td className="tnum">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone,
                    }).format(new Date(item.sentAt ?? item.sendAt))}
                  </td>
                  <td>{item.contactName ?? "Self"}</td>
                  <td>{item.accountEmail}</td>
                  <td>{item.origin.replaceAll("_", " ")}</td>
                  <td>
                    <span className={`queue-status queue-status--${queueTab(item.status)}`}>
                      <StatusIcon status={item.status} />
                      {statusLabel(item.status)}
                    </span>
                  </td>
                  <td>
                    <button
                      className="queue-review-link"
                      onClick={(event) => void openReview(item.id, event.currentTarget)}
                      type="button"
                    >
                      {item.subject}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="suppression-heading" className="suppression-panel">
        <div>
          <p className="eyebrow">Hard block</p>
          <h2 id="suppression-heading">Suppression</h2>
          <p>Every compose, queue creation, claim and send-now action checks this list.</p>
        </div>
        <form className="suppression-form" onSubmit={addSuppression}>
          <div className="field">
            <label htmlFor="suppression-email">Email address</label>
            <input id="suppression-email" name="email" required type="email" />
          </div>
          <button className="btn" disabled={pending} type="submit">
            <ShieldAlert aria-hidden="true" />
            Add suppression
          </button>
        </form>
        {suppression.length === 0 ? (
          <p className="section-empty">No suppression entries.</p>
        ) : (
          <ul className="suppression-list">
            {suppression.map((entry) => (
              <li key={entry.id}>
                <span>
                  <strong>{entry.email}</strong>
                  <small>{entry.reason.replaceAll("_", " ")}</small>
                </span>
                {entry.reason === "manual" ? (
                  <button
                    className="btn btn--danger"
                    disabled={pending}
                    onClick={() =>
                      void queueAction(
                        `/api/suppression/${encodeURIComponent(entry.id)}`,
                        { method: "DELETE" },
                        `${entry.email} is no longer manually suppressed.`,
                      )
                    }
                    type="button"
                  >
                    Remove manual block
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <dialog
        aria-labelledby="queue-review-heading"
        className="queue-dialog"
        onClose={closeReview}
        ref={dialog}
      >
        <header>
          <div>
            <p className="eyebrow">Exact message</p>
            <h2 id="queue-review-heading">Approval review</h2>
          </div>
          <button aria-label="Close approval review" className="icon-button" onClick={closeReview} type="button">
            <X aria-hidden="true" />
          </button>
        </header>
        {loadingDetail ? (
          <div className="data-state" role="status">
            <h3>Loading exact message…</h3>
          </div>
        ) : error ? (
          <p className="form-alert" role="alert">
            <AlertTriangle aria-hidden="true" />
            {error}
          </p>
        ) : detail ? (
          <div className="queue-review">
            <dl>
              <div><dt>Recipient</dt><dd>{detail.recipient}</dd></div>
              <div><dt>Account</dt><dd>{detail.accountEmail}</dd></div>
              <div><dt>Subject</dt><dd>{detail.subject}</dd></div>
              <div><dt>Time</dt><dd className="tnum">{detail.sendAt}</dd></div>
              <div>
                <dt>Attachments</dt>
                <dd>{detail.attachments.length ? detail.attachments.map((item) => item.name).join(", ") : "None"}</dd>
              </div>
            </dl>
            <section>
              <h3>Complete body</h3>
              <pre>{detail.body}</pre>
            </section>
            {detail.lastError ? (
              <p className="queue-stuck"><ShieldAlert aria-hidden="true" />{detail.lastError}</p>
            ) : null}
            {detail.status !== "sent" && detail.status !== "cancelled" ? (
              <div className="queue-review-actions">
                {detail.deliveryUncertain ? (
                  <label className="queue-resolution-confirm">
                    <input
                      checked={uncertainDeliveryAcknowledged}
                      onChange={(event) =>
                        setUncertainDeliveryAcknowledged(event.target.checked)
                      }
                      type="checkbox"
                    />
                    <span>I checked Gmail Sent and want to approve a new attempt.</span>
                  </label>
                ) : null}
                <div className="field">
                  <label htmlFor="queue-send-at">Approve and schedule in {timeZone}</label>
                  <input
                    id="queue-send-at"
                    onChange={(event) => setSendAt(event.target.value)}
                    type="datetime-local"
                    value={sendAt}
                  />
                </div>
                <button
                  className="btn"
                  disabled={
                    pending ||
                    !sendAt ||
                    (detail.deliveryUncertain && !uncertainDeliveryAcknowledged)
                  }
                  onClick={() =>
                    void queueAction(
                      `/api/queue/${encodeURIComponent(detail.id)}/approve`,
                      {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          sendAt,
                          uncertainDeliveryAcknowledged,
                        }),
                      },
                      "One exact message approved and scheduled.",
                    )
                  }
                  type="button"
                >
                  <Clock3 aria-hidden="true" />
                  Approve and schedule
                </button>
                <button
                  className="btn btn--ghost"
                  disabled={
                    pending ||
                    (detail.deliveryUncertain && !uncertainDeliveryAcknowledged)
                  }
                  onClick={() =>
                    void queueAction(
                      `/api/queue/${encodeURIComponent(detail.id)}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          action: "send_now",
                          uncertainDeliveryAcknowledged,
                        }),
                      },
                      "Send now approval recorded.",
                    )
                  }
                  type="button"
                >
                  <Send aria-hidden="true" />
                  Send now
                </button>
                <button
                  className="btn btn--ghost"
                  disabled={pending}
                  onClick={() =>
                    void queueAction(
                      `/api/queue/${encodeURIComponent(detail.id)}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "hold" }),
                      },
                      "Message held.",
                    )
                  }
                  type="button"
                >
                  <PauseCircle aria-hidden="true" />
                  Hold
                </button>
                <button
                  className="btn btn--danger"
                  disabled={pending}
                  onClick={() =>
                    void queueAction(
                      `/api/queue/${encodeURIComponent(detail.id)}`,
                      {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "cancel" }),
                      },
                      "Message cancelled.",
                    )
                  }
                  type="button"
                >
                  <CircleX aria-hidden="true" />
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
