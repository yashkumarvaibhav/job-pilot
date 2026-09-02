import {
  rolledUpPipelineStage,
  type ApplicationStage,
} from "./application";
import {
  parseDueSourceKey,
  type DueSourceKind,
} from "./due-source";
import {
  OPPORTUNITY_TERMINAL_STAGES,
  type OpportunityStage,
} from "./opportunity";

export {
  derivedDueItemTitle as todayDerivedActionTitle,
  DERIVED_REFERRAL_CHECK_TITLE as TODAY_REFERRAL_CHECK_TITLE,
} from "./due-source";

export const TODAY_EMPTY =
  "Nothing due today. Add a contact or a job to start the loop.";

export const TODAY_ERROR = "Could not load Today";

export const TODAY_ACTIVITY_LIMIT = 15;

export const TODAY_GMAIL_DISCONNECTED =
  "Gmail disconnected — sends will fail";

export const TODAY_STAT_TILES = [
  { key: "followUps", label: "Follow-ups" },
  { key: "needReply", label: "Need reply" },
  { key: "deadlines", label: "Deadlines" },
  { key: "interviewsToday", label: "Interviews today" },
] as const;

export const TODAY_PIPELINE_TILES = [
  { key: "saved", label: "Saved" },
  { key: "referral", label: "Referral" },
  { key: "applied", label: "Applied" },
  { key: "oa", label: "OA" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
] as const;

export type TodayStatKey = (typeof TODAY_STAT_TILES)[number]["key"];
export type TodayPipelineKey = (typeof TODAY_PIPELINE_TILES)[number]["key"];

export type TodayOpportunityPipelineTile = Exclude<
  TodayPipelineKey,
  "referral"
>;

const APPLIED_STAGES = new Set<string>([
  "applied",
  "application_confirmed",
  "under_review",
]);
const OA_STAGES = new Set<string>(["oa_received", "oa_completed"]);
const INTERVIEW_STAGES = new Set<string>([
  "interview_scheduled",
  "interview_round_1",
  "interview_round_2",
  "hiring_manager",
  "hr",
]);
const OFFER_STAGES = new Set<string>(["offer"]);
const CLOSED_APPLICATION_STAGES = new Set<string>([
  "rejected",
  "withdrawn",
  "ghosted",
]);

export function isDueOnOrBefore(
  dueOn: string | null | undefined,
  asOfOn: string,
): boolean {
  return typeof dueOn === "string" && dueOn.length > 0 && dueOn <= asOfOn;
}

export function todayDisconnectedCopy(
  gmailStatus: string | null | undefined,
): string | null {
  if (!gmailStatus || gmailStatus === "connected") {
    return null;
  }
  return TODAY_GMAIL_DISCONNECTED;
}

export function todayDoNowVerb(kind: DueSourceKind): string {
  switch (kind) {
    case "opportunity_next_action":
      return "Apply";
    case "opportunity_deadline":
      return "Apply";
    case "interview":
      return "Interview";
    case "assessment_deadline":
      return "Complete";
    case "offer_deadline":
      return "Decide";
    case "task":
      return "Do";
    default:
      return "Follow up";
  }
}

export function todayDoNowVerbForKey(sourceKey: string): string {
  const parsed = parseDueSourceKey(sourceKey);
  return parsed ? todayDoNowVerb(parsed.kind) : "Follow up";
}

export function todayDoNowHeading(
  sourceKey: string,
  verb: string,
  entityLabel: string,
): string {
  const parsed = parseDueSourceKey(sourceKey);
  if (parsed?.kind === "contact_next_action" && entityLabel.length > 0) {
    return `${verb} with ${entityLabel}`;
  }
  if (parsed?.kind === "assessment_deadline") {
    return entityLabel.length > 0
      ? `Complete ${entityLabel} assessment`
      : "Complete assessment";
  }
  if (parsed?.kind === "offer_deadline") {
    return entityLabel.length > 0
      ? `${entityLabel} offer deadline`
      : "Offer deadline";
  }
  return entityLabel.length > 0 ? entityLabel : verb;
}

export function todayOpportunityPipelineTile(
  opportunityStage: OpportunityStage,
  applicationStage: ApplicationStage | null | undefined,
): TodayOpportunityPipelineTile | null {
  if (
    OPPORTUNITY_TERMINAL_STAGES.some((stage) => stage.value === opportunityStage)
  ) {
    return null;
  }

  const rolled = rolledUpPipelineStage(opportunityStage, applicationStage);
  if (rolled.source === "opportunity") {
    return rolled.value === "applied" ? "applied" : "saved";
  }
  if (CLOSED_APPLICATION_STAGES.has(rolled.value)) {
    return null;
  }
  if (APPLIED_STAGES.has(rolled.value)) {
    return "applied";
  }
  if (OA_STAGES.has(rolled.value)) {
    return "oa";
  }
  if (INTERVIEW_STAGES.has(rolled.value)) {
    return "interview";
  }
  if (OFFER_STAGES.has(rolled.value)) {
    return "offer";
  }
  return null;
}
