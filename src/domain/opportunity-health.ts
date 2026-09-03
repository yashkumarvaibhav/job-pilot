import { shiftCalendarDate } from "./referral";

export type OpportunityHealth = {
  tone: "warning" | "danger";
  title: string;
  sentence: string;
  reasons: string[];
};

export function opportunityHealth(
  input: {
    deadlineOn: string | null;
    hasApplication: boolean;
    referralAvailable: boolean;
  },
  asOfOn: string,
): OpportunityHealth | null {
  if (input.hasApplication) {
    return null;
  }

  if (input.deadlineOn !== null && input.deadlineOn < asOfOn) {
    return {
      tone: "danger",
      title: "Deadline passed",
      sentence: `The application deadline was ${input.deadlineOn}.`,
      reasons: ["Application not submitted."],
    };
  }

  if (
    input.deadlineOn !== null &&
    input.deadlineOn <= shiftCalendarDate(asOfOn, 3)
  ) {
    const days = Math.round(
      (Date.parse(`${input.deadlineOn}T00:00:00.000Z`) -
        Date.parse(`${asOfOn}T00:00:00.000Z`)) /
        86_400_000,
    );
    return {
      tone: "warning",
      title: input.referralAvailable ? "Action required" : "Deadline soon",
      sentence: `Apply before ${input.deadlineOn}.`,
      reasons: [
        days === 0
          ? "Deadline is today."
          : `Deadline is in ${days} ${days === 1 ? "day" : "days"}.`,
        ...(input.referralAvailable ? ["Referral received."] : []),
        "Application not submitted.",
      ],
    };
  }

  if (input.referralAvailable) {
    return {
      tone: "warning",
      title: "Referral ready",
      sentence:
        "A referral is received, but the application is not submitted.",
      reasons: ["Referral received.", "Application not submitted."],
    };
  }

  return null;
}
