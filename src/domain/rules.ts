import { isOpenAssessmentStatus } from "./assessment";
import { isPendingInterviewResult } from "./interview";
import {
  OPPORTUNITY_TERMINAL_STAGES,
  type OpportunityStage,
} from "./opportunity";
import { shiftCalendarDate } from "./referral";

/**
 * Built-in automation only (D-014: sequence cancel lives in the sequence
 * engine; a user-authored editor is a non-goal). Thresholds are named
 * constants so a later tweak is one line, not a hunt through queries.
 */
export const RULE_THRESHOLDS = {
  referralNoResponseDays: 4,
  opportunityNoActivityDays: 7,
  noRecruiterResponseDays: 14,
  referralPromisedNotReceivedDays: 5,
  jobDeadlineDays: 3,
  assessmentDeadlineDays: 2,
} as const;

export const AUTOMATION_RULES = [
  {
    slug: "referral_no_response_follow_up",
    label: "No-response referral",
    kind: "write",
  },
  {
    slug: "referral_received_ready_to_apply",
    label: "Referral received → Ready to Apply",
    kind: "write",
  },
  {
    slug: "applied_cancel_referral_outreach",
    label: "Applied cancels referral outreach",
    kind: "write",
  },
  {
    slug: "stale_opportunity_no_activity",
    label: "No activity",
    kind: "stale",
  },
  {
    slug: "stale_no_recruiter_response",
    label: "No recruiter response",
    kind: "stale",
  },
  {
    slug: "stale_referral_promised_not_received",
    label: "Referral promised, not received",
    kind: "stale",
  },
  {
    slug: "stale_referral_received_not_applied",
    label: "Referral received, not applied",
    kind: "stale",
  },
  {
    slug: "stale_job_deadline",
    label: "Job deadline",
    kind: "stale",
  },
  {
    slug: "stale_assessment_deadline",
    label: "Assessment deadline",
    kind: "stale",
  },
  {
    slug: "stale_interview_past_no_result",
    label: "Interview past, no result",
    kind: "stale",
  },
  {
    slug: "stale_networking_check_later",
    label: "Check later date passed",
    kind: "stale",
  },
] as const;

export type AutomationRuleDefinition = (typeof AUTOMATION_RULES)[number];
export type AutomationRuleSlug = AutomationRuleDefinition["slug"];
export type AutomationRuleKind = AutomationRuleDefinition["kind"];
export type StaleEntityType = "opportunity" | "referral" | "contact";

export const AUTOMATION_RULES_TITLE = "Built-in rules";

export const AUTOMATION_RULES_HELP =
  "These run on your own workspace rows. Turning a rule off stops new runs; it does not rewrite history.";

export const REFERRAL_NO_RESPONSE_TASK_TITLE = "Follow up on referral";

export const CHECK_LATER_NETWORKING_STATUS = "follow_up_later";

export const PROMISED_NOT_RECEIVED_STAGES = [
  "referral_promised",
  "referral_submitted",
] as const;

const slugValues = new Set<string>(AUTOMATION_RULES.map((rule) => rule.slug));
const closedOpportunityStages = new Set<string>(
  OPPORTUNITY_TERMINAL_STAGES.map((stage) => stage.value),
);
const promisedStages = new Set<string>(PROMISED_NOT_RECEIVED_STAGES);

export type StaleMark = {
  slug: AutomationRuleSlug;
  entityType: StaleEntityType;
  entityId: string;
  reason: string;
};

export type StaleOpportunityRow = {
  id: string;
  bucket: string;
  stage: OpportunityStage;
  createdOn: string;
  deadlineOn: string | null;
  hasApplication: boolean;
};

export type StaleReferralRow = {
  id: string;
  opportunityId: string | null;
  stage: string;
  createdOn: string;
  requestedOn: string | null;
};

export type StaleContactRow = {
  id: string;
  networkingStatus: string;
  followUpOn: string | null;
};

export type StaleInteractionRow = {
  opportunityId: string | null;
  direction: "inbound" | "outbound";
  occurredOn: string;
  occurredAtMs: number;
};

export type StaleAssessmentRow = {
  id: string;
  opportunityId: string;
  status: string;
  dueOn: string | null;
};

export type StaleInterviewRow = {
  id: string;
  opportunityId: string;
  interviewOn: string | null;
  result: string | null;
};

export type StaleActivityRow = {
  entityType: string;
  entityId: string;
  opportunityId: string | null;
  atOn: string;
};

export type StaleScanInput = {
  asOfOn: string;
  enabled: ReadonlySet<string>;
  opportunities: readonly StaleOpportunityRow[];
  referrals: readonly StaleReferralRow[];
  contacts: readonly StaleContactRow[];
  interactions: readonly StaleInteractionRow[];
  assessments: readonly StaleAssessmentRow[];
  interviews: readonly StaleInterviewRow[];
  activity: readonly StaleActivityRow[];
};

export function isAutomationRuleSlug(
  value: unknown,
): value is AutomationRuleSlug {
  return typeof value === "string" && slugValues.has(value);
}

export function automationRuleBySlug(
  slug: AutomationRuleSlug,
): AutomationRuleDefinition {
  return AUTOMATION_RULES.find((rule) => rule.slug === slug)!;
}

export function automationRuleRowId(workspaceId: string, slug: string): string {
  return `${workspaceId}:${slug}`;
}

export function referralNoResponseTaskKey(referralId: string): string {
  return `rule:referral_no_response_follow_up:${referralId}`;
}

export function referralNoResponseDueOn(requestedOn: string): string {
  return shiftCalendarDate(
    requestedOn,
    RULE_THRESHOLDS.referralNoResponseDays,
  );
}

export function isOpportunityClosed(stage: OpportunityStage): boolean {
  return closedOpportunityStages.has(stage);
}

export function canAdvanceToReadyToApply(stage: OpportunityStage): boolean {
  return stage !== "applied" && stage !== "ready_to_apply" && !isOpportunityClosed(stage);
}

export function calendarDaysBetween(fromOn: string, toOn: string): number {
  const from = Date.parse(`${fromOn}T00:00:00.000Z`);
  const to = Date.parse(`${toOn}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000);
}

export function formatStaleReason(
  slug: AutomationRuleSlug,
  details: { days?: number; dateOn?: string } = {},
): string {
  switch (slug) {
    case "stale_opportunity_no_activity":
      return `No activity for ${details.days ?? RULE_THRESHOLDS.opportunityNoActivityDays} days`;
    case "stale_no_recruiter_response":
      return `No recruiter response ${details.days ?? RULE_THRESHOLDS.noRecruiterResponseDays} days after the last outbound`;
    case "stale_referral_promised_not_received":
      return `Referral promised ${details.days ?? RULE_THRESHOLDS.referralPromisedNotReceivedDays} days ago, not received`;
    case "stale_referral_received_not_applied":
      return "Referral received and no application submitted";
    case "stale_job_deadline":
      return details.dateOn
        ? `Job deadline ${details.dateOn}`
        : `Job deadline inside ${RULE_THRESHOLDS.jobDeadlineDays} days`;
    case "stale_assessment_deadline":
      return details.dateOn
        ? `Assessment deadline ${details.dateOn}`
        : `Assessment deadline inside ${RULE_THRESHOLDS.assessmentDeadlineDays} days`;
    case "stale_interview_past_no_result":
      return "Interview past with no result recorded";
    case "stale_networking_check_later":
      return details.dateOn
        ? `Check later date ${details.dateOn} has passed`
        : "Check later date has passed";
    default:
      return "";
  }
}

export function assertStaleMarkHasReason(mark: StaleMark): StaleMark {
  if (mark.reason.trim().length === 0) {
    throw new Error("A stale row must name the condition that fired.");
  }
  return mark;
}

function enabled(input: StaleScanInput, slug: AutomationRuleSlug): boolean {
  return input.enabled.has(slug);
}

function pushMark(
  marks: StaleMark[],
  mark: StaleMark,
  seen: Set<string>,
) {
  const key = `${mark.entityType}:${mark.entityId}:${mark.slug}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  marks.push(assertStaleMarkHasReason(mark));
}

function laterOn(current: string, candidate: string | null | undefined): string {
  if (!candidate) {
    return current;
  }
  return candidate > current ? candidate : current;
}

function lastOpportunityActivityOn(
  row: StaleOpportunityRow,
  input: StaleScanInput,
): string {
  let latest = row.createdOn;
  for (const event of input.activity) {
    if (event.entityType === "opportunity" && event.entityId === row.id) {
      latest = laterOn(latest, event.atOn);
    } else if (event.opportunityId === row.id) {
      latest = laterOn(latest, event.atOn);
    }
  }
  for (const referral of input.referrals) {
    if (referral.opportunityId === row.id) {
      latest = laterOn(latest, referral.createdOn);
      latest = laterOn(latest, referral.requestedOn);
    }
  }
  for (const interaction of input.interactions) {
    if (interaction.opportunityId === row.id) {
      latest = laterOn(latest, interaction.occurredOn);
    }
  }
  return latest;
}

function promisedClockOn(row: StaleReferralRow): string {
  return row.requestedOn ?? row.createdOn;
}

function applicationSubmittedFor(
  opportunityId: string | null,
  opportunities: readonly StaleOpportunityRow[],
): boolean {
  if (!opportunityId) {
    return false;
  }
  return opportunities.some(
    (row) => row.id === opportunityId && row.hasApplication,
  );
}

export function evaluateStaleMarks(input: StaleScanInput): StaleMark[] {
  const marks: StaleMark[] = [];
  const seen = new Set<string>();
  const asOfOn = input.asOfOn;

  if (enabled(input, "stale_opportunity_no_activity")) {
    const threshold = RULE_THRESHOLDS.opportunityNoActivityDays;
    for (const row of input.opportunities) {
      if (row.bucket !== "active" || isOpportunityClosed(row.stage)) {
        continue;
      }
      const lastOn = lastOpportunityActivityOn(row, input);
      if (lastOn > shiftCalendarDate(asOfOn, -threshold)) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_opportunity_no_activity",
          entityType: "opportunity",
          entityId: row.id,
          reason: formatStaleReason("stale_opportunity_no_activity", {
            days: calendarDaysBetween(lastOn, asOfOn),
          }),
        },
        seen,
      );
    }
  }

  if (enabled(input, "stale_no_recruiter_response")) {
    const threshold = RULE_THRESHOLDS.noRecruiterResponseDays;
    for (const row of input.opportunities) {
      if (isOpportunityClosed(row.stage)) {
        continue;
      }
      const related = input.interactions.filter(
        (item) => item.opportunityId === row.id,
      );
      const lastOutbound = related
        .filter((item) => item.direction === "outbound")
        .reduce<StaleInteractionRow | null>((latest, item) => {
          if (!latest || item.occurredAtMs > latest.occurredAtMs) {
            return item;
          }
          return latest;
        }, null);
      if (!lastOutbound) {
        continue;
      }
      const inboundAfter = related.some(
        (item) =>
          item.direction === "inbound" &&
          item.occurredAtMs > lastOutbound.occurredAtMs,
      );
      if (inboundAfter) {
        continue;
      }
      if (lastOutbound.occurredOn > shiftCalendarDate(asOfOn, -threshold)) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_no_recruiter_response",
          entityType: "opportunity",
          entityId: row.id,
          reason: formatStaleReason("stale_no_recruiter_response", {
            days: calendarDaysBetween(lastOutbound.occurredOn, asOfOn),
          }),
        },
        seen,
      );
    }
  }

  if (enabled(input, "stale_referral_promised_not_received")) {
    const threshold = RULE_THRESHOLDS.referralPromisedNotReceivedDays;
    for (const row of input.referrals) {
      if (!promisedStages.has(row.stage)) {
        continue;
      }
      const clockOn = promisedClockOn(row);
      if (clockOn > shiftCalendarDate(asOfOn, -threshold)) {
        continue;
      }
      const reason = formatStaleReason("stale_referral_promised_not_received", {
        days: calendarDaysBetween(clockOn, asOfOn),
      });
      pushMark(
        marks,
        {
          slug: "stale_referral_promised_not_received",
          entityType: "referral",
          entityId: row.id,
          reason,
        },
        seen,
      );
      if (row.opportunityId) {
        pushMark(
          marks,
          {
            slug: "stale_referral_promised_not_received",
            entityType: "opportunity",
            entityId: row.opportunityId,
            reason,
          },
          seen,
        );
      }
    }
  }

  if (enabled(input, "stale_referral_received_not_applied")) {
    for (const row of input.referrals) {
      if (row.stage !== "referral_received") {
        continue;
      }
      if (applicationSubmittedFor(row.opportunityId, input.opportunities)) {
        continue;
      }
      const reason = formatStaleReason("stale_referral_received_not_applied");
      pushMark(
        marks,
        {
          slug: "stale_referral_received_not_applied",
          entityType: "referral",
          entityId: row.id,
          reason,
        },
        seen,
      );
      if (row.opportunityId) {
        pushMark(
          marks,
          {
            slug: "stale_referral_received_not_applied",
            entityType: "opportunity",
            entityId: row.opportunityId,
            reason,
          },
          seen,
        );
      }
    }
  }

  if (enabled(input, "stale_job_deadline")) {
    const horizon = RULE_THRESHOLDS.jobDeadlineDays;
    for (const row of input.opportunities) {
      if (!row.deadlineOn || isOpportunityClosed(row.stage)) {
        continue;
      }
      if (row.deadlineOn > shiftCalendarDate(asOfOn, horizon)) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_job_deadline",
          entityType: "opportunity",
          entityId: row.id,
          reason: formatStaleReason("stale_job_deadline", {
            dateOn: row.deadlineOn,
          }),
        },
        seen,
      );
    }
  }

  if (enabled(input, "stale_assessment_deadline")) {
    const horizon = RULE_THRESHOLDS.assessmentDeadlineDays;
    for (const row of input.assessments) {
      if (!isOpenAssessmentStatus(row.status) || !row.dueOn) {
        continue;
      }
      if (row.dueOn > shiftCalendarDate(asOfOn, horizon)) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_assessment_deadline",
          entityType: "opportunity",
          entityId: row.opportunityId,
          reason: formatStaleReason("stale_assessment_deadline", {
            dateOn: row.dueOn,
          }),
        },
        seen,
      );
    }
  }

  if (enabled(input, "stale_interview_past_no_result")) {
    for (const row of input.interviews) {
      if (!row.interviewOn || row.interviewOn >= asOfOn) {
        continue;
      }
      if (!isPendingInterviewResult(row.result)) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_interview_past_no_result",
          entityType: "opportunity",
          entityId: row.opportunityId,
          reason: formatStaleReason("stale_interview_past_no_result"),
        },
        seen,
      );
    }
  }

  if (enabled(input, "stale_networking_check_later")) {
    for (const row of input.contacts) {
      if (row.networkingStatus !== CHECK_LATER_NETWORKING_STATUS) {
        continue;
      }
      if (!row.followUpOn || row.followUpOn >= asOfOn) {
        continue;
      }
      pushMark(
        marks,
        {
          slug: "stale_networking_check_later",
          entityType: "contact",
          entityId: row.id,
          reason: formatStaleReason("stale_networking_check_later", {
            dateOn: row.followUpOn,
          }),
        },
        seen,
      );
    }
  }

  return marks;
}

export function indexStaleMarks(marks: readonly StaleMark[]): {
  opportunity: Map<string, StaleMark[]>;
  referral: Map<string, StaleMark[]>;
  contact: Map<string, StaleMark[]>;
} {
  const opportunity = new Map<string, StaleMark[]>();
  const referral = new Map<string, StaleMark[]>();
  const contact = new Map<string, StaleMark[]>();
  for (const mark of marks) {
    const bucket =
      mark.entityType === "opportunity"
        ? opportunity
        : mark.entityType === "referral"
          ? referral
          : contact;
    const list = bucket.get(mark.entityId) ?? [];
    list.push(mark);
    bucket.set(mark.entityId, list);
  }
  return { opportunity, referral, contact };
}
