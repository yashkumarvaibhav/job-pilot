import { ArrowDown, ArrowUp, CheckCircle2, Circle, Minus, type LucideIcon } from "lucide-react";

import {
  taskPriorityLabel,
  taskSourceLabel,
  taskStatusLabel,
  type TaskPriority,
  type TaskSource,
  type TaskStatus,
} from "@/domain/task";

const statusVisuals: Record<
  TaskStatus,
  { icon: LucideIcon; tone: "info" | "success" }
> = {
  open: { icon: Circle, tone: "info" },
  completed: { icon: CheckCircle2, tone: "success" },
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const { icon: Icon, tone } = statusVisuals[status];
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {taskStatusLabel(status)}
    </span>
  );
}

export function TaskPriorityChip({ priority }: { priority: TaskPriority }) {
  const Icon =
    priority === "high" ? ArrowUp : priority === "low" ? ArrowDown : Minus;
  const tone =
    priority === "high" ? "danger" : priority === "medium" ? "warning" : "muted";
  return (
    <span className="chip contact-status-chip" data-tone={tone}>
      <Icon aria-hidden="true" />
      {taskPriorityLabel(priority)}
    </span>
  );
}

export function TaskSourceChip({ source }: { source: TaskSource }) {
  return (
    <span className="chip contact-status-chip" data-tone="muted">
      {taskSourceLabel(source)}
    </span>
  );
}

export function taskEntityHref(
  entityType: string | null,
  entityId: string | null,
): string | null {
  if (!entityType || !entityId) {
    return null;
  }
  if (entityType === "company") return `/companies/${entityId}`;
  if (entityType === "contact") return `/contacts/${entityId}`;
  if (entityType === "opportunity") return `/opportunities/${entityId}`;
  if (entityType === "referral") return `/referrals/${entityId}`;
  if (entityType === "application") return "/applications";
  return null;
}
