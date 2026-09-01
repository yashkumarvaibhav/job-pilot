export const CONTACT_RELATIONSHIPS = [
  { value: "friend", label: "Friend" },
  { value: "college_friend", label: "College friend" },
  { value: "alumni", label: "Alumni" },
  { value: "employee", label: "Employee" },
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring_manager", label: "Hiring Manager" },
  { value: "former_employee", label: "Former employee" },
  { value: "mutual_connection", label: "Mutual connection" },
  { value: "community_contact", label: "Community contact" },
  { value: "unknown_cold_contact", label: "Unknown / cold contact" },
  { value: "other", label: "Other" },
] as const;

export type ContactRelationship =
  (typeof CONTACT_RELATIONSHIPS)[number]["value"];

export const NETWORKING_STATUSES = [
  { value: "not_contacted", label: "Not Contacted" },
  { value: "ready_to_contact", label: "Ready to Contact" },
  { value: "contacted", label: "Contacted" },
  { value: "waiting_for_reply", label: "Waiting for Reply" },
  { value: "checking_for_openings", label: "Checking for Openings" },
  { value: "follow_up_later", label: "Follow Up Later" },
  { value: "opening_found", label: "Opening Found" },
  { value: "referral_discussion", label: "Referral Discussion" },
  { value: "referral_promised", label: "Referral Promised" },
  { value: "no_openings_currently", label: "No Openings Currently" },
  { value: "keep_in_touch", label: "Keep in Touch" },
  { value: "do_not_contact", label: "Do Not Contact" },
  { value: "inactive", label: "Inactive" },
] as const;

export type NetworkingStatus =
  (typeof NETWORKING_STATUSES)[number]["value"];

export const DEFAULT_NETWORKING_STATUS: NetworkingStatus = "not_contacted";
export const DO_NOT_CONTACT: NetworkingStatus = "do_not_contact";

const networkingStatusValues = new Set<string>(
  NETWORKING_STATUSES.map(({ value }) => value),
);
const relationshipValues = new Set<string>(
  CONTACT_RELATIONSHIPS.map(({ value }) => value),
);

export function isNetworkingStatus(value: unknown): value is NetworkingStatus {
  return typeof value === "string" && networkingStatusValues.has(value);
}

export function isContactRelationship(
  value: unknown,
): value is ContactRelationship {
  return typeof value === "string" && relationshipValues.has(value);
}

export class NetworkingStatusTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkingStatusTransitionError";
  }
}

export function transitionNetworkingStatus(
  current: NetworkingStatus,
  next: NetworkingStatus,
  options: { overrideDoNotContact?: boolean } = {},
): NetworkingStatus {
  if (
    current === DO_NOT_CONTACT &&
    next !== DO_NOT_CONTACT &&
    options.overrideDoNotContact !== true
  ) {
    throw new NetworkingStatusTransitionError(
      "Leaving Do Not Contact requires an explicit override.",
    );
  }

  return next;
}
