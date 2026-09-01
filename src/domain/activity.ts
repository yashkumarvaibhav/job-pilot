import { INTERACTION_CHANNELS } from "./interaction";
import { calendarDateInZone } from "./referral";

const KIND_VERBS: Record<string, string> = {
  ACCOUNT_FOUNDATION_CREATED: "Workspace created",
  SETTINGS_TIMEZONE_CHANGED: "Timezone updated",
  COMPANY_CREATED: "Company created",
  COMPANY_UPDATED: "Company updated",
  COMPANY_DELETED: "Company deleted",
  CONTACT_CREATED: "Contact created",
  CONTACT_UPDATED: "Contact updated",
  CONTACT_DELETED: "Contact deleted",
  OPPORTUNITY_CREATED: "Job saved",
  OPPORTUNITY_UPDATED: "Job updated",
  OPPORTUNITY_CONTACT_LINKED: "Contact linked",
  APPLICATION_SUBMITTED: "Application submitted",
  APPLICATION_UPDATED: "Application updated",
  REFERRAL_CREATED: "Referral requested",
  REFERRAL_UPDATED: "Referral updated",
  TASK_CREATED: "Task created",
  TASK_UPDATED: "Task updated",
  TASK_COMPLETED: "Task completed",
  INTERACTION_SENT: "Message sent",
  INTERACTION_REPLIED: "Reply received",
  INTERACTION_LOGGED: "Interaction logged",
  TAG_ATTACHED: "Tag added",
  TAG_DETACHED: "Tag removed",
  TAG_DELETED: "Tag deleted",
};

const channelByValue = new Map<string, string>(
  INTERACTION_CHANNELS.map((channel) => [channel.value, channel.label]),
);

export function activityVerb(
  kind: string,
  payload: Record<string, unknown> = {},
): string {
  if (kind === "INTERACTION_SENT" || kind === "INTERACTION_REPLIED") {
    const channel = payload.channel;
    if (typeof channel === "string" && channelByValue.has(channel)) {
      const label = channelByValue.get(channel) as string;
      return kind === "INTERACTION_REPLIED" ? `${label} reply received` : `${label} sent`;
    }
  }

  if (kind === "TAG_ATTACHED" && typeof payload.label === "string") {
    return `Tagged ${payload.label}`;
  }

  return KIND_VERBS[kind] ?? kind.replaceAll("_", " ").toLowerCase();
}

export function formatActivityHeadline(input: {
  kind: string;
  entityLabel: string | null;
  payload?: Record<string, unknown>;
}): string {
  const verb = activityVerb(input.kind, input.payload);
  if (!input.entityLabel) {
    return verb;
  }

  const inbound = input.kind === "INTERACTION_REPLIED";
  return inbound
    ? `${verb} ← ${input.entityLabel}`
    : `${verb} → ${input.entityLabel}`;
}

export function formatActivityTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export function activityCalendarDate(at: Date, timeZone: string): string {
  return calendarDateInZone(timeZone, at);
}

export function isValidActivityDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function activityDayHeading(day: string, todayOn: string): string {
  return day === todayOn ? "Today" : day;
}
