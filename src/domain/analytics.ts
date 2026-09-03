import type { ApplicationStage } from "./application";
import {
  INTERACTION_CHANNELS,
  interactionChannelLabel,
  type InteractionChannel,
  type InteractionDirection,
} from "./interaction";
import type { OpportunityBucket } from "./opportunity";
import type { ReferralStage } from "./referral";

export const ANALYTICS_EMPTY =
  "Not enough outcomes to chart. Counts appear once applications exist.";

export const ANALYTICS_HONESTY = "n < 5 — not enough data";

export const ANALYTICS_MIN_N = 5;

export const ANALYTICS_ERROR = "Could not load analytics";

export const ANALYTICS_LOADING = "Loading analytics";

export const FUNNEL_STEPS = [
  { key: "opportunitiesPursued", label: "Opportunities pursued" },
  { key: "referralAttempts", label: "Referral attempts" },
  { key: "referralsObtained", label: "Referrals obtained" },
  { key: "applications", label: "Applications" },
  { key: "oa", label: "OA" },
  { key: "interviews", label: "Interviews" },
  { key: "offers", label: "Offers" },
] as const;

export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];

export const SLICE_COLUMNS = [
  { key: "referral", label: "Referral applications" },
  { key: "cold", label: "Cold applications" },
] as const;

export type ApplicationSlice = (typeof SLICE_COLUMNS)[number]["key"];

export const COMPANY_CONVERSION_TILES = [
  { key: "activeOpportunities", label: "Active opportunities" },
  { key: "applications", label: "Applications" },
  { key: "contacts", label: "Contacts" },
  { key: "referralRequests", label: "Referral requests" },
  { key: "referralsReceived", label: "Referrals received" },
  { key: "interviews", label: "Interviews" },
] as const;

export type CompanyConversionKey =
  (typeof COMPANY_CONVERSION_TILES)[number]["key"];

export type RateDisplay = {
  percent: number | null;
  label: string | null;
  suppressed: boolean;
  denominator: number;
};

export type FunnelStep = {
  key: FunnelStepKey;
  label: string;
  count: number;
  rate: RateDisplay;
};

export type SliceColumn = {
  key: ApplicationSlice;
  label: string;
  applications: number;
  interviews: number;
  rate: RateDisplay;
};

export type ChannelRow = {
  channel: InteractionChannel;
  label: string;
  attempts: number;
  replies: number;
  referrals: number;
};

export type AnalyticsSnapshot = {
  empty: boolean;
  emptyCopy: string;
  funnel: FunnelStep[];
  slices: SliceColumn[];
  channels: ChannelRow[];
};

export type CompanyConversionStats = Record<CompanyConversionKey, number>;

export type AnalyticsOpportunityFact = {
  id: string;
  bucket: OpportunityBucket;
};

export type AnalyticsApplicationFact = {
  id: string;
  opportunityId: string;
  stage: ApplicationStage;
};

export type AnalyticsReferralFact = {
  id: string;
  opportunityId: string | null;
  stage: ReferralStage;
  channel: InteractionChannel;
};

export type AnalyticsInteractionFact = {
  channel: InteractionChannel;
  direction: InteractionDirection;
};

export type AnalyticsInterviewFact = {
  opportunityId: string;
};

export type AnalyticsFacts = {
  opportunities: AnalyticsOpportunityFact[];
  applications: AnalyticsApplicationFact[];
  referrals: AnalyticsReferralFact[];
  interactions: AnalyticsInteractionFact[];
  interviews: AnalyticsInterviewFact[];
};

export type CompanyConversionFacts = {
  opportunities: Array<{ bucket: OpportunityBucket }>;
  applications: unknown[];
  contacts: unknown[];
  referrals: Array<{ stage: ReferralStage }>;
  interviews: unknown[];
};

const OA_STAGES = new Set<ApplicationStage>(["oa_received", "oa_completed"]);
const ATTEMPT_EXCLUDED = new Set<ReferralStage>([
  "potential_contact",
  "ready_to_contact",
]);

export function rateForDenominator(
  numerator: number,
  denominator: number,
): RateDisplay {
  if (denominator < ANALYTICS_MIN_N) {
    return {
      percent: null,
      label: ANALYTICS_HONESTY,
      suppressed: true,
      denominator,
    };
  }

  const percent = Number(((numerator / denominator) * 100).toFixed(1));
  return {
    percent,
    label: `${percent.toFixed(1)}%`,
    suppressed: false,
    denominator,
  };
}

export function applicationSlice(
  opportunityId: string,
  receivedReferralOpportunityIds: ReadonlySet<string>,
): ApplicationSlice {
  return receivedReferralOpportunityIds.has(opportunityId)
    ? "referral"
    : "cold";
}

export function isReferralAttemptStage(stage: ReferralStage): boolean {
  return !ATTEMPT_EXCLUDED.has(stage);
}

export function isReferralObtainedStage(stage: ReferralStage): boolean {
  return stage === "referral_received";
}

export function isFunnelOaStage(stage: ApplicationStage): boolean {
  return OA_STAGES.has(stage);
}

export function isFunnelOfferStage(stage: ApplicationStage): boolean {
  return stage === "offer";
}

function receivedReferralOpportunityIds(
  referrals: AnalyticsReferralFact[],
): Set<string> {
  return new Set(
    referrals
      .filter(
        (row) =>
          isReferralObtainedStage(row.stage) && row.opportunityId != null,
      )
      .map((row) => row.opportunityId as string),
  );
}

function interviewedOpportunityIds(
  interviews: AnalyticsInterviewFact[],
): Set<string> {
  return new Set(interviews.map((row) => row.opportunityId));
}

function noRate(): RateDisplay {
  return {
    percent: null,
    label: null,
    suppressed: false,
    denominator: 0,
  };
}

function sliceColumn(
  key: ApplicationSlice,
  applications: AnalyticsApplicationFact[],
  interviewed: ReadonlySet<string>,
): SliceColumn {
  const interviews = applications.filter((row) =>
    interviewed.has(row.opportunityId),
  ).length;
  return {
    key,
    label: SLICE_COLUMNS.find((column) => column.key === key)!.label,
    applications: applications.length,
    interviews,
    rate: rateForDenominator(interviews, applications.length),
  };
}

export function buildAnalyticsSnapshot(facts: AnalyticsFacts): AnalyticsSnapshot {
  const referralAttempts = facts.referrals.filter((row) =>
    isReferralAttemptStage(row.stage),
  ).length;
  const referralsObtained = facts.referrals.filter((row) =>
    isReferralObtainedStage(row.stage),
  ).length;
  const oa = facts.applications.filter((row) =>
    isFunnelOaStage(row.stage),
  ).length;
  const interviewed = interviewedOpportunityIds(facts.interviews);
  const interviews = interviewed.size;
  const offers = facts.applications.filter((row) =>
    isFunnelOfferStage(row.stage),
  ).length;
  const applicationCount = facts.applications.length;
  const empty = applicationCount === 0;
  const received = receivedReferralOpportunityIds(facts.referrals);

  const counts: Record<FunnelStepKey, number> = {
    opportunitiesPursued: facts.opportunities.length,
    referralAttempts,
    referralsObtained,
    applications: applicationCount,
    oa,
    interviews,
    offers,
  };

  const rates: Record<FunnelStepKey, RateDisplay> = {
    opportunitiesPursued: noRate(),
    referralAttempts: noRate(),
    referralsObtained: rateForDenominator(referralsObtained, referralAttempts),
    applications: noRate(),
    oa: rateForDenominator(oa, applicationCount),
    interviews: rateForDenominator(interviews, applicationCount),
    offers: rateForDenominator(offers, applicationCount),
  };

  const grouped = new Map<
    InteractionChannel,
    { attempts: number; replies: number; referrals: number }
  >();

  function channelBucket(channel: InteractionChannel) {
    const existing = grouped.get(channel);
    if (existing) {
      return existing;
    }
    const created = { attempts: 0, replies: 0, referrals: 0 };
    grouped.set(channel, created);
    return created;
  }

  for (const row of facts.interactions) {
    const bucket = channelBucket(row.channel);
    if (row.direction === "outbound") {
      bucket.attempts += 1;
    } else {
      bucket.replies += 1;
    }
  }

  for (const row of facts.referrals) {
    if (!isReferralObtainedStage(row.stage)) {
      continue;
    }
    channelBucket(row.channel).referrals += 1;
  }

  const sliceApps: Record<ApplicationSlice, AnalyticsApplicationFact[]> = {
    referral: [],
    cold: [],
  };
  for (const row of facts.applications) {
    sliceApps[applicationSlice(row.opportunityId, received)].push(row);
  }

  const channels: ChannelRow[] = [];
  for (const channel of INTERACTION_CHANNELS) {
    const bucket = grouped.get(channel.value);
    if (!bucket) {
      continue;
    }
    channels.push({
      channel: channel.value,
      label: interactionChannelLabel(channel.value),
      attempts: bucket.attempts,
      replies: bucket.replies,
      referrals: bucket.referrals,
    });
  }
  channels.sort((left, right) => {
    if (right.attempts !== left.attempts) {
      return right.attempts - left.attempts;
    }
    if (right.replies !== left.replies) {
      return right.replies - left.replies;
    }
    return left.label.localeCompare(right.label);
  });

  return {
    empty,
    emptyCopy: ANALYTICS_EMPTY,
    funnel: FUNNEL_STEPS.map((step) => ({
      key: step.key,
      label: step.label,
      count: counts[step.key],
      rate: empty ? { ...rates[step.key], percent: null } : rates[step.key],
    })),
    slices: SLICE_COLUMNS.map((column) =>
      sliceColumn(column.key, sliceApps[column.key], interviewed),
    ),
    channels,
  };
}

export function buildCompanyConversion(
  facts: CompanyConversionFacts,
): CompanyConversionStats {
  return {
    activeOpportunities: facts.opportunities.filter(
      (row) => row.bucket === "active",
    ).length,
    applications: facts.applications.length,
    contacts: facts.contacts.length,
    referralRequests: facts.referrals.length,
    referralsReceived: facts.referrals.filter((row) =>
      isReferralObtainedStage(row.stage),
    ).length,
    interviews: facts.interviews.length,
  };
}
