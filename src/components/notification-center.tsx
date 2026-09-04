"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import {
  BriefcaseBusiness,
  CalendarClock,
  ClipboardCheck,
  Handshake,
  ListTodo,
  Mail,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

import {
  SNOOZE_PRESETS,
  groupNotificationCards,
  notificationKindLabel,
  type SnoozePreset,
} from "@/domain/notification";
import type { DueSourceKind } from "@/domain/due-source";
import { taskEntityHref } from "@/components/task-status";

export type NotificationView = {
  id: string;
  kind: DueSourceKind;
  entityType: string | null;
  entityId: string | null;
  title: string;
  body: string | null;
  dueOn: string;
  dueKey: string;
  groupKey: string | null;
};

const kindVisuals: Record<
  DueSourceKind,
  { icon: LucideIcon; tone: "info" | "warning" | "muted" | "success" }
> = {
  company_next_action: { icon: BriefcaseBusiness, tone: "info" },
  contact_next_action: { icon: CalendarClock, tone: "warning" },
  opportunity_next_action: { icon: BriefcaseBusiness, tone: "info" },
  opportunity_deadline: { icon: CalendarClock, tone: "warning" },
  referral_follow_up: { icon: Handshake, tone: "success" },
  interview: { icon: MessagesSquare, tone: "info" },
  assessment_deadline: { icon: ClipboardCheck, tone: "warning" },
  offer_deadline: { icon: Handshake, tone: "warning" },
  sequence_follow_up: { icon: Mail, tone: "info" },
  task: { icon: ListTodo, tone: "muted" },
};

const PRESET_LABELS: Record<SnoozePreset, string> = {
  "1h": "1 hour",
  "3h": "3 hours",
  tomorrow: "Tomorrow",
  monday: "Monday",
};

function KindChip({ kind }: { kind: DueSourceKind }) {
  const { icon: Icon, tone } = kindVisuals[kind];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {notificationKindLabel(kind)}
    </span>
  );
}

function responseError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
    ? (value as { error: string }).error
    : fallback;
}

export function NotificationMaterialize() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/materialize", { method: "POST" })
      .then(() => {
        if (!cancelled) router.refresh();
      })
      .catch(() => {
        if (!cancelled) router.refresh();
      });
    return () => {
      cancelled = true;
    };
  }, [router]);
  return null;
}

function NotificationActions({
  ids,
  kind,
}: {
  ids: string[];
  kind: DueSourceKind;
}) {
  const router = useRouter();
  const customId = useId();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  async function post(path: string, body: Record<string, unknown>) {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        setMessage(responseError(payload, "Could not update the reminder."));
        return;
      }
      setCustomOpen(false);
      router.refresh();
    } catch {
      setMessage("Could not reach Job Pilot. Check the connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="notification-actions">
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => post("/api/notifications/done", { ids })}
        type="button"
      >
        Mark done
      </button>
      {SNOOZE_PRESETS.map((preset) => (
        <button
          className="btn btn--ghost"
          disabled={pending}
          key={preset}
          onClick={() => post("/api/notifications/snooze", { ids, preset })}
          type="button"
        >
          Snooze {PRESET_LABELS[preset]}
        </button>
      ))}
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => setCustomOpen((open) => !open)}
        type="button"
      >
        Custom
      </button>
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => post("/api/notifications/dismiss", { ids })}
        type="button"
      >
        Dismiss
      </button>
      <button
        className="btn btn--ghost"
        disabled={pending}
        onClick={() => post("/api/notifications/mute", { kind })}
        type="button"
      >
        Mute this type
      </button>
      {customOpen ? (
        <form
          className="notification-custom-snooze"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get("until") ?? "",
            );
            if (!value) return;
            void post("/api/notifications/snooze", {
              ids,
              until: new Date(value).toISOString(),
            });
          }}
        >
          <label htmlFor={customId}>Custom date and time</label>
          <input
            disabled={pending}
            id={customId}
            name="until"
            required
            type="datetime-local"
          />
          <button className="btn" disabled={pending} type="submit">
            Snooze
          </button>
        </form>
      ) : null}
      {message ? (
        <p className="form-alert" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function NotificationCollection({
  empty,
  rows,
}: {
  empty: string;
  rows: NotificationView[];
}) {
  if (rows.length === 0) {
    return (
      <div className="data-state data-state--empty">
        <p>{empty}</p>
      </div>
    );
  }

  const cards = groupNotificationCards(rows);

  return (
    <>
      <div className="table-scroll task-table-wrap">
        <table className="tbl task-table">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Title</th>
              <th scope="col">Entity</th>
              <th scope="col">Due</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => {
              const lead = card.members[0]!;
              const href = taskEntityHref(lead.entityType, lead.entityId);
              const title = lead.title;
              const reason =
                card.members.length > 1
                  ? card.members
                      .map((member) => member.body)
                      .filter(Boolean)
                      .join(" · ")
                  : lead.body;
              return (
                <tr key={card.groupKey ?? lead.dueKey}>
                  <td>
                    <KindChip kind={lead.kind} />
                  </td>
                  <td>
                    <span>{title}</span>
                    {reason ? <small>{reason}</small> : null}
                  </td>
                  <td>
                    {href ? (
                      <Link className="table-link" href={href}>
                        Open
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="tnum">{lead.dueOn}</td>
                  <td>
                    <NotificationActions
                      ids={card.members.map((member) => member.id)}
                      kind={lead.kind}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul aria-label="Notifications" className="task-card-list">
        {cards.map((card) => {
          const lead = card.members[0]!;
          const href = taskEntityHref(lead.entityType, lead.entityId);
          const reason =
            card.members.length > 1
              ? card.members
                  .map((member) => member.body)
                  .filter(Boolean)
                  .join(" · ")
              : lead.body;
          return (
            <li
              className="task-list-card"
              key={card.groupKey ?? lead.dueKey}
            >
              <span className="task-list-card__heading">
                <strong>{lead.title}</strong>
                <KindChip kind={lead.kind} />
              </span>
              {reason ? <span>{reason}</span> : null}
              <span className="tnum">Due {lead.dueOn}</span>
              {href ? (
                <Link className="inline-link" href={href}>
                  Open
                </Link>
              ) : null}
              <NotificationActions
                ids={card.members.map((member) => member.id)}
                kind={lead.kind}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
