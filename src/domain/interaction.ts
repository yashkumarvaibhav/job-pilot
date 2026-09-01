export const INTERACTION_CHANNELS = [
  { value: "email", label: "Email" },
  { value: "linkedin_dm", label: "LinkedIn DM" },
  { value: "linkedin_connection_note", label: "LinkedIn connection note" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone" },
  { value: "telegram", label: "Telegram" },
  { value: "slack_discord", label: "Slack / Discord" },
  { value: "company_referral_portal", label: "Company referral portal" },
  { value: "alumni_network", label: "Alumni network" },
  { value: "college_network", label: "College network" },
  { value: "in_person", label: "In-person" },
  { value: "other", label: "Other" },
] as const;

export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number]["value"];

export const INTERACTION_DIRECTIONS = [
  { value: "outbound", label: "Outbound" },
  { value: "inbound", label: "Inbound" },
] as const;

export type InteractionDirection =
  (typeof INTERACTION_DIRECTIONS)[number]["value"];

const channelValues = new Set<string>(
  INTERACTION_CHANNELS.map(({ value }) => value),
);
const directionValues = new Set<string>(
  INTERACTION_DIRECTIONS.map(({ value }) => value),
);

export function isInteractionChannel(
  value: unknown,
): value is InteractionChannel {
  return typeof value === "string" && channelValues.has(value);
}

export function isInteractionDirection(
  value: unknown,
): value is InteractionDirection {
  return typeof value === "string" && directionValues.has(value);
}

export function interactionChannelLabel(value: InteractionChannel) {
  return INTERACTION_CHANNELS.find((channel) => channel.value === value)!.label;
}

export function interactionDirectionLabel(value: InteractionDirection) {
  return INTERACTION_DIRECTIONS.find((direction) => direction.value === value)!
    .label;
}
