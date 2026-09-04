export const DEFAULT_CONTACT_COOLDOWN_DAYS = 30;
export const DEFAULT_MAX_OUTREACH_PER_OPPORTUNITY = 10;
export const DUPLICATE_OUTREACH_WARN_AT = 6;
export const SOFT_BOUNCE_SUPPRESS_AFTER = 3;
export const FIND_ANOTHER_CONTACT_TITLE = "Find another contact";

export type BounceKind = "hard" | "soft";

export type BounceParseInput = {
  fromEmail: string;
  subject: string;
  body: string;
  deliveryStatusText?: string | null;
  failedRecipients?: readonly string[];
};

export type BounceSignal = {
  kind: BounceKind;
  recipient: string;
  smtpStatus: string | null;
  diagnostic: string | null;
};

const EMAIL = /[^\s<>;,]+@[^\s<>;,]+/g;
const STATUS_LINE = /(?:^|\n)\s*Status:\s*([245]\.\d+\.\d+)/i;
const ACTION_LINE = /(?:^|\n)\s*Action:\s*(failed|delayed|delivered|relayed|expanded)/i;
const DIAGNOSTIC_LINE = /(?:^|\n)\s*Diagnostic-Code:\s*(?:smtp;\s*)?(.+)/i;
const FINAL_RECIPIENT = /(?:^|\n)\s*(?:Final|Original)-Recipient:\s*(?:rfc822;\s*)?([^\s]+)/i;
const SMTP_CODE = /\b([245]\d\d)\b/;
const HARD_PHRASES =
  /mailbox unavailable|user unknown|unknown user|address not found|does not exist|no such user|recipient rejected|undeliverable/i;
const SOFT_PHRASES =
  /mailbox full|over quota|temporarily deferred|try again later|greylist|subject to delay/i;

function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^<|>$/g, "");
  if (!trimmed.includes("@") || trimmed.includes(" ")) return null;
  const angle = trimmed.match(/<([^<>]+)>/);
  const value = (angle?.[1] ?? trimmed).replace(/[>,;]+$/g, "");
  return value.includes("@") ? value : null;
}

function firstEmail(value: string): string | null {
  const match = value.match(EMAIL);
  return match ? normalizeAddress(match[0]) : null;
}

function recipientFromInput(input: BounceParseInput, report: string): string | null {
  const headerMatch = report.match(FINAL_RECIPIENT);
  if (headerMatch) {
    const fromReport = normalizeAddress(headerMatch[1]);
    if (fromReport) return fromReport;
  }
  for (const candidate of input.failedRecipients ?? []) {
    const normalized = normalizeAddress(candidate);
    if (normalized) return normalized;
  }
  return firstEmail(report) ?? firstEmail(input.body);
}

function smtpStatus(report: string, diagnostic: string | null): string | null {
  const status = report.match(STATUS_LINE)?.[1];
  if (status) return status;
  const code = diagnostic?.match(SMTP_CODE)?.[1];
  return code ?? null;
}

function classify(
  action: string | null,
  status: string | null,
  diagnostic: string | null,
  text: string,
): BounceKind | null {
  if (action === "delivered" || action === "relayed" || action === "expanded") {
    return null;
  }
  const classDigit = status?.slice(0, 1);
  if (classDigit === "5" || (action === "failed" && classDigit !== "4") || HARD_PHRASES.test(text)) {
    return "hard";
  }
  if (classDigit === "4" || action === "delayed" || SOFT_PHRASES.test(text)) {
    return "soft";
  }
  const code = diagnostic?.match(SMTP_CODE)?.[1];
  if (code?.startsWith("5")) return "hard";
  if (code?.startsWith("4")) return "soft";
  return null;
}

export function bounceSourceKey(recipient: string): string {
  return `bounce:${recipient}`;
}

export function bounceTaskKey(contactId: string): string {
  return `bounce:${contactId}:find_another`;
}

function looksLikeDeliveryReport(input: BounceParseInput): boolean {
  if ((input.deliveryStatusText ?? "").trim().length > 0) return true;
  if ((input.failedRecipients ?? []).some((value) => value.trim().length > 0)) {
    return true;
  }
  const daemon = /mailer-daemon|postmaster/i.test(input.fromEmail);
  const dsnSubject =
    /delivery status notification|undelivered mail|mail delivery failed/i.test(
      input.subject,
    );
  return daemon && dsnSubject;
}

export function parseBounceSignal(input: BounceParseInput): BounceSignal | null {
  if (!looksLikeDeliveryReport(input)) return null;
  const report = [input.deliveryStatusText ?? "", input.body, input.subject]
    .filter((part) => part.trim().length > 0)
    .join("\n");
  if (!report.trim()) return null;
  const action = report.match(ACTION_LINE)?.[1]?.toLowerCase() ?? null;
  const diagnostic = report.match(DIAGNOSTIC_LINE)?.[1]?.trim() ?? null;
  const status = smtpStatus(report, diagnostic);
  const kind = classify(action, status, diagnostic, report);
  if (!kind) return null;
  const recipient = recipientFromInput(input, report);
  if (!recipient) return null;
  return {
    kind,
    recipient,
    smtpStatus: status,
    diagnostic,
  };
}
