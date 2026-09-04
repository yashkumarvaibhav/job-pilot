import { SequenceError, type SequenceEnrollment, type SequenceListItem, type SequenceReview } from "./sequences";

export const SEQUENCE_OVERRIDE_KEYS = [
  "sendAnyway",
  "freshnessOverride",
  "skipSync",
  "forceSend",
] as const;

export function sequenceJson(row: SequenceListItem) {
  return {
    id: row.id,
    name: row.name,
    enrollmentCount: row.enrollmentCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      offsetDays: step.offsetDays,
      templateId: step.templateId,
    })),
  };
}

export function enrollmentJson(row: SequenceEnrollment) {
  return {
    id: row.id,
    sequenceId: row.sequenceId,
    contactId: row.contactId,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    currentStepId: row.currentStepId,
    status: row.status,
    cancelReason: row.cancelReason,
    nextAt: row.nextAt.toISOString(),
    enrolledAt: row.enrolledAt.toISOString(),
  };
}

export function sequenceReviewJson(review: SequenceReview) {
  return {
    id: review.id,
    accountEmail: review.accountEmail,
    contactName: review.contactName,
    origin: review.origin,
    status: review.status,
    recipient: review.recipient,
    subject: review.subject,
    body: review.body,
    attachments: review.attachments,
    sendAt: review.sendAt.toISOString(),
    sentAt: review.sentAt?.toISOString() ?? null,
    lastError: review.lastError,
    deliveryUncertain: false,
    sendAnywayAvailable: false,
    approvalRequired: true,
  };
}

export function sequenceErrorStatus(error: SequenceError): number {
  if (/not found/i.test(error.message)) return 404;
  return 409;
}

export function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function sequenceRequestKeys(input: Record<string, unknown>): string[] {
  return Object.keys(input);
}

export function sequenceOverrideRejected(keys: readonly string[]): SequenceError | null {
  if (keys.some((key) => SEQUENCE_OVERRIDE_KEYS.includes(key as (typeof SEQUENCE_OVERRIDE_KEYS)[number]))) {
    return new SequenceError(
      "Sequence messages cannot skip the mailbox freshness check.",
    );
  }
  return null;
}

export function readSequenceWriteInput(
  input: Record<string, unknown>,
): { name?: string; steps?: Array<{ offsetDays: number; templateId: string }> } | null {
  const keys = Object.keys(input);
  if (
    keys.length === 0 ||
    keys.some((key) => key !== "name" && key !== "steps") ||
    (input.name !== undefined && typeof input.name !== "string") ||
    (input.steps !== undefined &&
      (!Array.isArray(input.steps) ||
        input.steps.some(
          (step) =>
            typeof step !== "object" ||
            step === null ||
            Array.isArray(step) ||
            typeof (step as { offsetDays?: unknown }).offsetDays !== "number" ||
            typeof (step as { templateId?: unknown }).templateId !== "string" ||
            Object.keys(step).some((key) => key !== "offsetDays" && key !== "templateId"),
        )))
  ) {
    return null;
  }
  return input as { name?: string; steps?: Array<{ offsetDays: number; templateId: string }> };
}

export function readEnrollInput(
  input: Record<string, unknown>,
): { contactId: string; accountId: string; opportunityId?: string | null } | null {
  if (
    Object.keys(input).some(
      (key) => key !== "contactId" && key !== "accountId" && key !== "opportunityId",
    ) ||
    typeof input.contactId !== "string" ||
    typeof input.accountId !== "string" ||
    (input.opportunityId !== undefined &&
      input.opportunityId !== null &&
      typeof input.opportunityId !== "string")
  ) {
    return null;
  }
  return input as { contactId: string; accountId: string; opportunityId?: string | null };
}
