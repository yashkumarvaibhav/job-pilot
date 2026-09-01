import {
  Archive,
  Ban,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleMinus,
  Clock3,
  Handshake,
  HeartHandshake,
  MessagesSquare,
  Search,
  Send,
  type LucideIcon,
} from "lucide-react";

import {
  CONTACT_METHOD_KINDS,
  CONTACT_RELATIONSHIPS,
  NETWORKING_STATUSES,
  type ContactMethodKind,
  type ContactRelationship,
  type NetworkingStatus,
} from "@/domain/contact";

const statusVisuals: Record<
  NetworkingStatus,
  { icon: LucideIcon; tone: "danger" | "info" | "muted" | "success" | "warning" }
> = {
  not_contacted: { icon: Circle, tone: "muted" },
  ready_to_contact: { icon: Send, tone: "info" },
  contacted: { icon: CheckCircle2, tone: "info" },
  waiting_for_reply: { icon: Clock3, tone: "warning" },
  checking_for_openings: { icon: Search, tone: "info" },
  follow_up_later: { icon: CalendarClock, tone: "warning" },
  opening_found: { icon: BriefcaseBusiness, tone: "success" },
  referral_discussion: { icon: MessagesSquare, tone: "info" },
  referral_promised: { icon: Handshake, tone: "success" },
  no_openings_currently: { icon: CircleMinus, tone: "muted" },
  keep_in_touch: { icon: HeartHandshake, tone: "success" },
  do_not_contact: { icon: Ban, tone: "danger" },
  inactive: { icon: Archive, tone: "muted" },
};

export function networkingStatusLabel(value: NetworkingStatus) {
  return NETWORKING_STATUSES.find((status) => status.value === value)!.label;
}

export function relationshipLabel(value: ContactRelationship) {
  return CONTACT_RELATIONSHIPS.find(
    (relationship) => relationship.value === value,
  )!.label;
}

export function contactMethodKindLabel(value: ContactMethodKind) {
  return CONTACT_METHOD_KINDS.find((kind) => kind.value === value)!.label;
}

export function ContactStatusChip({ status }: { status: NetworkingStatus }) {
  const { icon: Icon, tone } = statusVisuals[status];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {networkingStatusLabel(status)}
    </span>
  );
}
