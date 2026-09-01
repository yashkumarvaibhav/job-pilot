export const DUE_SOURCE_KINDS = [
  "company_next_action",
  "contact_next_action",
  "opportunity_next_action",
  "referral_follow_up",
  "task",
] as const;

export type DueSourceKind = (typeof DUE_SOURCE_KINDS)[number];

const KIND_BY_PREFIX: Record<string, DueSourceKind> = {
  "company:": "company_next_action",
  "contact:": "contact_next_action",
  "opportunity:": "opportunity_next_action",
  "referral:": "referral_follow_up",
  "task:": "task",
};

/**
 * Stable due provenance (D-031). Identity is the source, never the calendar day.
 * Contact and referral keep their existing follow-up date columns; company and
 * opportunity use next_action_due. This module is the only place the key format
 * is defined.
 */
export function dueSourceKey(kind: DueSourceKind, entityId: string): string {
  const id = entityId.trim();
  if (id.length === 0) {
    throw new RangeError("A due-source key needs an entity id.");
  }

  switch (kind) {
    case "company_next_action":
      return `company:${id}:next_action`;
    case "contact_next_action":
      return `contact:${id}:next_action`;
    case "opportunity_next_action":
      return `opportunity:${id}:next_action`;
    case "referral_follow_up":
      return `referral:${id}:follow_up`;
    case "task":
      return `task:${id}`;
  }
}

export function parseDueSourceKey(
  key: string,
): { kind: DueSourceKind; entityId: string } | null {
  const nextAction = key.match(
    /^(company|contact|opportunity):(.+):next_action$/,
  );
  if (nextAction) {
    const prefix = `${nextAction[1]}:`;
    return {
      kind: KIND_BY_PREFIX[prefix],
      entityId: nextAction[2],
    };
  }

  const referral = key.match(/^referral:(.+):follow_up$/);
  if (referral) {
    return { kind: "referral_follow_up", entityId: referral[1] };
  }

  const task = key.match(/^task:(.+)$/);
  if (task) {
    return { kind: "task", entityId: task[1] };
  }

  return null;
}

export function reschedulePreservesKey(
  key: string,
  _fromOn: string,
  _toOn: string,
): string {
  void _fromOn;
  void _toOn;
  return key;
}
