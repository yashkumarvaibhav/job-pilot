export const REPLY_CLASSIFICATIONS = [
  { value: "referral_promised", label: "Referral promised" },
  { value: "referral_submitted", label: "Referral submitted" },
  { value: "declined", label: "Declined" },
  { value: "need_to_respond", label: "Need to respond" },
  { value: "no_opening", label: "No opening" },
  { value: "follow_up_later", label: "Follow up later" },
  { value: "not_relevant", label: "Not relevant" },
] as const;

export type ReplyClassification =
  (typeof REPLY_CLASSIFICATIONS)[number]["value"];

const values = new Set<string>(
  REPLY_CLASSIFICATIONS.map((classification) => classification.value),
);

export function isReplyClassification(
  value: unknown,
): value is ReplyClassification {
  return typeof value === "string" && values.has(value);
}

export function replyClassificationLabel(value: ReplyClassification): string {
  return REPLY_CLASSIFICATIONS.find((item) => item.value === value)!.label;
}
