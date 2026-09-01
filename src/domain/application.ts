import {
  opportunityStageLabel,
  type OpportunityStage,
} from "./opportunity";

export const APPLICATION_STAGES = [
  { value: "applied", label: "Applied" },
  { value: "application_confirmed", label: "Application Confirmed" },
  { value: "under_review", label: "Under Review" },
  { value: "oa_received", label: "OA Received" },
  { value: "oa_completed", label: "OA Completed" },
  { value: "interview_scheduled", label: "Interview Scheduled" },
  { value: "interview_round_1", label: "Interview Round 1" },
  { value: "interview_round_2", label: "Interview Round 2" },
  { value: "hiring_manager", label: "Hiring Manager" },
  { value: "hr", label: "HR" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "ghosted", label: "Ghosted" },
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number]["value"];

export const DEFAULT_APPLICATION_STAGE: ApplicationStage = "applied";

export const APPLICATION_RESULT_STAGES = [
  "offer",
  "rejected",
  "withdrawn",
  "ghosted",
] as const;

export type ApplicationResultStage =
  (typeof APPLICATION_RESULT_STAGES)[number];

const applicationStageValues = new Set<string>(
  APPLICATION_STAGES.map(({ value }) => value),
);
const applicationResultValues = new Set<string>(APPLICATION_RESULT_STAGES);

export type RolledUpStageSource = "opportunity" | "application";

export type RolledUpStage = {
  value: OpportunityStage | ApplicationStage;
  label: string;
  source: RolledUpStageSource;
};

export function isApplicationStage(
  value: unknown,
): value is ApplicationStage {
  return typeof value === "string" && applicationStageValues.has(value);
}

export function applicationStageLabel(value: ApplicationStage): string {
  return APPLICATION_STAGES.find((stage) => stage.value === value)!.label;
}

export function isApplicationResultStage(
  value: unknown,
): value is ApplicationResultStage {
  return typeof value === "string" && applicationResultValues.has(value);
}

export function applicationResultLabel(
  stage: ApplicationStage,
): string {
  return isApplicationResultStage(stage)
    ? applicationStageLabel(stage)
    : "—";
}

export function rolledUpPipelineStage(
  opportunityStage: OpportunityStage,
  applicationStage: ApplicationStage | null | undefined,
): RolledUpStage {
  if (applicationStage) {
    return {
      value: applicationStage,
      label: applicationStageLabel(applicationStage),
      source: "application",
    };
  }

  return {
    value: opportunityStage,
    label: opportunityStageLabel(opportunityStage),
    source: "opportunity",
  };
}
