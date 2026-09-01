import {
  Archive,
  Ban,
  CheckCircle2,
  Circle,
  Clock3,
  Eye,
  FileText,
  Handshake,
  Send,
  TimerOff,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import {
  referralStageLabel,
  type ReferralStage,
} from "@/domain/referral";

const stageVisuals: Record<
  ReferralStage,
  { icon: LucideIcon; tone: "danger" | "info" | "muted" | "success" | "warning" }
> = {
  potential_contact: { icon: Circle, tone: "muted" },
  ready_to_contact: { icon: Send, tone: "info" },
  requested: { icon: Clock3, tone: "warning" },
  seen_acknowledged: { icon: Eye, tone: "info" },
  asked_for_resume: { icon: FileText, tone: "info" },
  resume_sent: { icon: FileText, tone: "info" },
  agreed_to_refer: { icon: UserRound, tone: "info" },
  referral_promised: { icon: Handshake, tone: "success" },
  referral_submitted: { icon: Send, tone: "success" },
  referral_received: { icon: CheckCircle2, tone: "success" },
  declined: { icon: Ban, tone: "danger" },
  no_response: { icon: Clock3, tone: "muted" },
  expired: { icon: TimerOff, tone: "muted" },
  cancelled: { icon: Archive, tone: "muted" },
};

export function ReferralStageChip({ stage }: { stage: ReferralStage }) {
  const { icon: Icon, tone } = stageVisuals[stage];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {referralStageLabel(stage)}
    </span>
  );
}
