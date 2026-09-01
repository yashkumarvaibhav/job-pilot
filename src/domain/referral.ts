export const REFERRAL_STAGES = [
  { value: "potential_contact", label: "Potential Contact" },
  { value: "ready_to_contact", label: "Ready to Contact" },
  { value: "requested", label: "Requested" },
  { value: "seen_acknowledged", label: "Seen / Acknowledged" },
  { value: "asked_for_resume", label: "Asked for Resume" },
  { value: "resume_sent", label: "Resume Sent" },
  { value: "agreed_to_refer", label: "Agreed to Refer" },
  { value: "referral_promised", label: "Referral Promised" },
  { value: "referral_submitted", label: "Referral Submitted" },
  { value: "referral_received", label: "Referral Received" },
  { value: "declined", label: "Declined" },
  { value: "no_response", label: "No Response" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type ReferralStage = (typeof REFERRAL_STAGES)[number]["value"];

export const DEFAULT_REFERRAL_STAGE: ReferralStage = "potential_contact";

export const REFERRAL_HAPPY_PATH_STAGES = [
  "potential_contact",
  "ready_to_contact",
  "requested",
  "seen_acknowledged",
  "asked_for_resume",
  "resume_sent",
  "agreed_to_refer",
  "referral_promised",
  "referral_submitted",
  "referral_received",
] as const satisfies readonly ReferralStage[];

export type ReferralHappyPathStage =
  (typeof REFERRAL_HAPPY_PATH_STAGES)[number];

export const REFERRAL_TERMINAL_STAGES = [
  "declined",
  "no_response",
  "expired",
  "cancelled",
] as const satisfies readonly ReferralStage[];

export type ReferralTerminalStage = (typeof REFERRAL_TERMINAL_STAGES)[number];

export const REFERRAL_RESTART_STAGES = [
  "potential_contact",
  "ready_to_contact",
] as const satisfies readonly ReferralStage[];

export const REFERRAL_LIST_PRESETS = [
  { value: "no_reply", label: "No reply > 4 days" },
  {
    value: "promised_not_received",
    label: "Referral promised but not received",
  },
  {
    value: "received_not_applied",
    label: "Referral received but application not submitted",
  },
] as const;

export type ReferralListPreset = (typeof REFERRAL_LIST_PRESETS)[number]["value"];

const referralStageValues = new Set<string>(
  REFERRAL_STAGES.map(({ value }) => value),
);
const happyPathIndex = new Map<ReferralStage, number>(
  REFERRAL_HAPPY_PATH_STAGES.map((stage, index) => [stage, index]),
);
const terminalValues = new Set<string>(REFERRAL_TERMINAL_STAGES);
const restartValues = new Set<string>(REFERRAL_RESTART_STAGES);
const presetValues = new Set<string>(
  REFERRAL_LIST_PRESETS.map(({ value }) => value),
);

export function isReferralStage(value: unknown): value is ReferralStage {
  return typeof value === "string" && referralStageValues.has(value);
}

export function isReferralListPreset(
  value: unknown,
): value is ReferralListPreset {
  return typeof value === "string" && presetValues.has(value);
}

export function isReferralTerminalStage(
  value: unknown,
): value is ReferralTerminalStage {
  return typeof value === "string" && terminalValues.has(value);
}

export function referralStageLabel(value: ReferralStage): string {
  return REFERRAL_STAGES.find((stage) => stage.value === value)!.label;
}

export function selectableReferralStages(
  _current?: ReferralStage,
): typeof REFERRAL_STAGES {
  void _current;
  return REFERRAL_STAGES;
}

export class ReferralStageTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralStageTransitionError";
  }
}

export function isReferralCorrection(
  current: ReferralStage,
  next: ReferralStage,
): boolean {
  if (current === next) {
    return false;
  }
  const fromIndex = happyPathIndex.get(current);
  const toIndex = happyPathIndex.get(next);
  if (fromIndex !== undefined && toIndex !== undefined) {
    return toIndex < fromIndex;
  }
  return isReferralTerminalStage(current) && restartValues.has(next);
}

export function transitionReferralStage(
  current: ReferralStage,
  next: ReferralStage,
): ReferralStage {
  if (!isReferralStage(next)) {
    throw new ReferralStageTransitionError("Choose a valid referral stage.");
  }
  if (current === next) {
    return next;
  }
  if (
    isReferralTerminalStage(current) &&
    happyPathIndex.has(next) &&
    !restartValues.has(next)
  ) {
    throw new ReferralStageTransitionError(
      "A closed referral can only restart at Potential Contact or Ready to Contact.",
    );
  }
  return next;
}

export function calendarDateInZone(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function shiftCalendarDate(value: string, days: number): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function matchesNoReplyPreset(
  row: { stage: ReferralStage; requestedOn: string | null },
  asOfOn: string,
): boolean {
  return (
    row.stage === "requested" &&
    row.requestedOn !== null &&
    row.requestedOn <= shiftCalendarDate(asOfOn, -4)
  );
}

export function matchesPromisedNotReceivedPreset(stage: ReferralStage): boolean {
  return stage === "referral_promised" || stage === "referral_submitted";
}

export function matchesReceivedNotAppliedPreset(
  stage: ReferralStage,
  hasSubmittedApplication: boolean,
): boolean {
  return stage === "referral_received" && !hasSubmittedApplication;
}
