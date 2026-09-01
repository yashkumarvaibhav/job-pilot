import {
  Archive,
  Ban,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardCheck,
  FileCheck,
  FileText,
  Handshake,
  MessagesSquare,
  Send,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import { OpportunityStageChip } from "@/components/opportunity-form";
import {
  applicationStageLabel,
  rolledUpPipelineStage,
  type ApplicationStage,
} from "@/domain/application";
import type { OpportunityStage } from "@/domain/opportunity";

const stageVisuals: Record<
  ApplicationStage,
  { icon: LucideIcon; tone: "danger" | "info" | "muted" | "success" | "warning" }
> = {
  applied: { icon: Send, tone: "info" },
  application_confirmed: { icon: CheckCircle2, tone: "info" },
  under_review: { icon: ClipboardCheck, tone: "warning" },
  oa_received: { icon: FileText, tone: "warning" },
  oa_completed: { icon: FileCheck, tone: "info" },
  interview_scheduled: { icon: MessagesSquare, tone: "info" },
  interview_round_1: { icon: Users, tone: "info" },
  interview_round_2: { icon: Users, tone: "info" },
  hiring_manager: { icon: BriefcaseBusiness, tone: "info" },
  hr: { icon: UserRound, tone: "info" },
  offer: { icon: Handshake, tone: "success" },
  rejected: { icon: Ban, tone: "danger" },
  withdrawn: { icon: Archive, tone: "muted" },
  ghosted: { icon: Archive, tone: "muted" },
};

export function ApplicationStageChip({ stage }: { stage: ApplicationStage }) {
  const { icon: Icon, tone } = stageVisuals[stage];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {applicationStageLabel(stage)}
    </span>
  );
}

export function RolledUpStageChip({
  opportunityStage,
  applicationStage,
}: {
  opportunityStage: OpportunityStage;
  applicationStage: ApplicationStage | null | undefined;
}) {
  const rolled = rolledUpPipelineStage(opportunityStage, applicationStage);
  if (rolled.source === "application" && applicationStage) {
    return <ApplicationStageChip stage={applicationStage} />;
  }
  return <OpportunityStageChip stage={opportunityStage} />;
}

export function stageMachineLabel(
  applicationStage: ApplicationStage | null | undefined,
) {
  return applicationStage ? "Application stage" : "Pursuit stage";
}
