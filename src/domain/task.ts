export const TASK_STATUSES = [
  { value: "open", label: "Open" },
  { value: "completed", label: "Completed" },
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number]["value"];

export const DEFAULT_TASK_STATUS: TaskStatus = "open";

export const TASK_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number]["value"];

export const DEFAULT_TASK_PRIORITY: TaskPriority = "medium";

export const TASK_SOURCES = [
  { value: "manual", label: "Manual" },
  { value: "rule", label: "Rule" },
] as const;

export type TaskSource = (typeof TASK_SOURCES)[number]["value"];

export const DEFAULT_TASK_SOURCE: TaskSource = "manual";

export const TASK_LINK_TYPES = [
  "company",
  "contact",
  "opportunity",
  "application",
  "referral",
] as const;

export type TaskLinkType = (typeof TASK_LINK_TYPES)[number];

const statusValues = new Set<string>(TASK_STATUSES.map(({ value }) => value));
const priorityValues = new Set<string>(
  TASK_PRIORITIES.map(({ value }) => value),
);
const sourceValues = new Set<string>(TASK_SOURCES.map(({ value }) => value));
const linkTypeValues = new Set<string>(TASK_LINK_TYPES);

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && statusValues.has(value);
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && priorityValues.has(value);
}

export function isTaskSource(value: unknown): value is TaskSource {
  return typeof value === "string" && sourceValues.has(value);
}

export function isTaskLinkType(value: unknown): value is TaskLinkType {
  return typeof value === "string" && linkTypeValues.has(value);
}

export function isTerminalTaskStatus(value: unknown): value is "completed" {
  return value === "completed";
}

export function taskStatusLabel(value: TaskStatus): string {
  return TASK_STATUSES.find((item) => item.value === value)!.label;
}

export function taskPriorityLabel(value: TaskPriority): string {
  return TASK_PRIORITIES.find((item) => item.value === value)!.label;
}

export function taskSourceLabel(value: TaskSource): string {
  return TASK_SOURCES.find((item) => item.value === value)!.label;
}
