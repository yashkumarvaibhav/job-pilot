import {
  DEFAULT_CONTACT_COOLDOWN_DAYS,
  DEFAULT_MAX_OUTREACH_PER_OPPORTUNITY,
  DUPLICATE_OUTREACH_WARN_AT,
} from "./bounce";
import {
  interactionChannelLabel,
  type InteractionChannel,
} from "./interaction";

export type OutreachWarningKind = "cooldown" | "duplicate_outreach";

export type OutreachChannelCount = {
  channel: InteractionChannel;
  count: number;
};

export type CooldownWarningInput = {
  contactName: string;
  daysAgo: number;
  companyName?: string | null;
  role?: string | null;
  channelCounts: OutreachChannelCount[];
  lastChannel?: InteractionChannel | null;
  lastResponseBody?: string | null;
};

export type OutreachWarning = {
  kind: OutreachWarningKind;
  copy: string;
  lastChannel?: InteractionChannel | null;
  lastResponseBody?: string | null;
  contactedCount?: number;
};

const MS_PER_DAY = 86_400_000;

export function outreachDaysAgo(lastAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.valueOf() - lastAt.valueOf()) / MS_PER_DAY));
}

export function isWithinCooldown(
  lastAt: Date,
  now: Date,
  cooldownDays = DEFAULT_CONTACT_COOLDOWN_DAYS,
): boolean {
  return outreachDaysAgo(lastAt, now) < cooldownDays;
}

export function shouldWarnDuplicateOutreach(
  alreadyContacted: number,
  maxOutreach = DEFAULT_MAX_OUTREACH_PER_OPPORTUNITY,
): boolean {
  return (
    alreadyContacted >= DUPLICATE_OUTREACH_WARN_AT ||
    alreadyContacted >= maxOutreach
  );
}

function daysAgoPhrase(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function channelLine(channel: InteractionChannel, count: number): string {
  if (channel === "email") {
    return count === 1 ? "1 email" : `${count} emails`;
  }
  if (channel === "linkedin_dm" || channel === "linkedin_connection_note") {
    return count === 1
      ? "1 LinkedIn interaction"
      : `${count} LinkedIn interactions`;
  }
  const label = interactionChannelLabel(channel);
  return count === 1 ? `1 ${label}` : `${count} ${label}`;
}

function groupedChannelLines(counts: OutreachChannelCount[]): string[] {
  const linkedIn = counts
    .filter(
      (item) =>
        item.channel === "linkedin_dm" ||
        item.channel === "linkedin_connection_note",
    )
    .reduce((sum, item) => sum + item.count, 0);
  const lines: string[] = [];
  const email = counts.find((item) => item.channel === "email");
  if (email) lines.push(channelLine("email", email.count));
  if (linkedIn > 0) lines.push(channelLine("linkedin_dm", linkedIn));
  for (const item of counts) {
    if (
      item.channel === "email" ||
      item.channel === "linkedin_dm" ||
      item.channel === "linkedin_connection_note"
    ) {
      continue;
    }
    lines.push(channelLine(item.channel, item.count));
  }
  return lines;
}

export function formatCooldownWarning(input: CooldownWarningInput): string {
  const lines = [
    `You contacted ${input.contactName} ${daysAgoPhrase(input.daysAgo)}.`,
    "",
  ];
  if (input.companyName?.trim()) {
    lines.push(`Company: ${input.companyName.trim()}`);
  }
  if (input.role?.trim()) {
    lines.push(`Role: ${input.role.trim()}`);
  }
  if (input.companyName?.trim() || input.role?.trim()) {
    lines.push("");
  }
  const channels = groupedChannelLines(input.channelCounts);
  if (channels.length > 0) {
    lines.push(...channels, "");
  }
  if (input.lastChannel) {
    lines.push(`Last channel: ${interactionChannelLabel(input.lastChannel)}`);
  }
  const response = input.lastResponseBody?.trim();
  if (response) {
    lines.push("Last response:", `"${response}"`, "");
  } else if (input.lastChannel) {
    lines.push("");
  }
  lines.push("Continue?");
  return lines.join("\n");
}

export function formatDuplicateOutreachWarning(contactedCount: number): string {
  return `You have already contacted ${contactedCount} people at this company for this opportunity.`;
}
