import { calendarDateInZone } from "./referral";
import { hourOfDayInZone, isQuietHourInZone } from "./settings";

export const DIGEST_SUBJECT = "Your Job Search Summary";

export const DIGEST_EMAIL_LABEL = "Email my morning digest";

export const DIGEST_PREVIEW_TITLE = "Morning digest preview";

export const DIGEST_HELP =
  "Enabling this authorises one automatic morning digest per local day, from and to the selected Gmail address. Preview stays available either way. There is no editable recipient.";

export const DIGEST_ACCOUNT_HELP =
  "The digest uses only this connected account. Changing the default sender does not retarget it. Selecting another account turns the digest off until you enable it again.";

export const DIGEST_DISABLED_HELP =
  "Connect a Gmail account, then select it here, before Job Pilot can email you a morning digest. Preview stays available.";

export const DIGEST_HOUR_HELP =
  "The tick prepares the digest once the saved timezone reaches this hour, and waits if quiet hours are still on.";

export const DIGEST_PREVIEW_EMPTY =
  "Nothing is due in this workspace yet. Counts here match Today.";

export type DigestCounts = {
  followUps: number;
  deadlines: number;
  oa: number;
  replies: number;
  interviewsToday: number;
};

export type DigestOutcome =
  | "previewed"
  | "queued"
  | "skipped_disconnected"
  | "skipped_quiet";

export type DigestTickAction =
  | "skip_hour"
  | "preview"
  | "enqueue"
  | "skip_disconnected"
  | "skip_already_queued"
  | "skip_quiet";

export type DigestPolicySnapshot = {
  enabled: boolean;
  accountId: string | null;
  approvedEmail: string | null;
  digestHour: number | null;
  timeZone: string;
  quietStart: number | null;
  quietEnd: number | null;
};

function countLine(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Deterministic list for the digest body and the preview page. Zeroes stay visible. */
export function formatDigestBody(counts: DigestCounts): string {
  return [
    "TODAY",
    "",
    countLine(counts.followUps, "follow-up due", "follow-ups due"),
    countLine(counts.deadlines, "deadline", "deadlines"),
    countLine(counts.oa, "OA", "OA"),
    countLine(
      counts.replies,
      "recruiter reply awaiting action",
      "recruiter replies awaiting action",
    ),
    countLine(
      counts.interviewsToday,
      "interview today",
      "interviews today",
    ),
  ].join("\n");
}

export function parseDigestHour(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const hour =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(?:[01]?\d|2[0-3])$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError("Digest hour must be a whole hour from 0 to 23.");
  }
  return hour;
}

export function canUseSelfDigestPolicy(input: {
  origin: string;
  recipient: string;
  accountEmail: string;
}): boolean {
  return (
    input.origin === "self_digest" &&
    input.recipient.trim().toLowerCase() ===
      input.accountEmail.trim().toLowerCase()
  );
}

export function digestLocalDate(timeZone: string, at: Date): string {
  return calendarDateInZone(timeZone, at);
}

export function digestTickAction(input: {
  now: Date;
  policy: DigestPolicySnapshot;
  accountStatus: "connected" | "disconnected" | "error" | null;
  currentAccountEmail: string | null;
  queuedLocalDate: string | null;
}): DigestTickAction {
  if (input.policy.digestHour == null) {
    return "skip_hour";
  }
  if (hourOfDayInZone(input.policy.timeZone, input.now) < input.policy.digestHour) {
    return "skip_hour";
  }

  const localDate = digestLocalDate(input.policy.timeZone, input.now);
  if (input.queuedLocalDate === localDate) {
    return "skip_already_queued";
  }

  const optInLive =
    input.policy.enabled &&
    Boolean(input.policy.accountId) &&
    Boolean(input.policy.approvedEmail);
  if (!optInLive) {
    return "preview";
  }

  if (
    isQuietHourInZone(
      input.policy.timeZone,
      input.now,
      input.policy.quietStart,
      input.policy.quietEnd,
    )
  ) {
    return "skip_quiet";
  }

  const liveAddress =
    input.currentAccountEmail?.trim().toLowerCase() ?? "";
  const approvedAddress = input.policy.approvedEmail?.trim().toLowerCase() ?? "";
  if (
    input.accountStatus !== "connected" ||
    liveAddress.length === 0 ||
    liveAddress !== approvedAddress
  ) {
    return "skip_disconnected";
  }

  return "enqueue";
}
