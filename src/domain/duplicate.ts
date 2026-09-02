export const DUPLICATE_SIGNALS = [
  "same_name",
  "same_url",
  "same_company_job_id",
  "same_company_role_location_dates",
] as const;

export type DuplicateSignal = (typeof DUPLICATE_SIGNALS)[number];

export const DUPLICATE_COMPANY_WARNING =
  "This company may already be tracked.";
export const DUPLICATE_JOB_WARNING = "This job may already be tracked.";

const SIGNAL_LABELS: Record<DuplicateSignal, string> = {
  same_name: "same name",
  same_url: "same URL",
  same_company_job_id: "same company and job ID",
  same_company_role_location_dates: "same company, role, location, and dates",
};

export type CompanyDuplicateInput = {
  name: string;
  website?: string | null;
  careersUrl?: string | null;
};

export type OpportunityDuplicateInput = {
  companyId: string;
  role: string;
  jobId?: string | null;
  url?: string | null;
  location?: string | null;
  postedOn?: string | null;
  deadlineOn?: string | null;
};

export type DuplicateCandidate = {
  id: string;
  entityType: "company" | "opportunity";
  label: string;
  href: string;
  signals: DuplicateSignal[];
};

export type DuplicateConflict = {
  error: string;
  candidates: DuplicateCandidate[];
};

export class DuplicateConflictError extends Error {
  readonly candidates: DuplicateCandidate[];

  constructor(message: string, candidates: DuplicateCandidate[]) {
    super(message);
    this.name = "DuplicateConflictError";
    this.candidates = candidates;
  }
}

export function duplicateOverridePayload(candidates: DuplicateCandidate[]) {
  return {
    duplicateOverride: true,
    candidateIds: candidates.map((candidate) => candidate.id),
    signals: [...new Set(candidates.flatMap((candidate) => candidate.signals))],
  };
}

export function duplicateSignalLabel(signal: DuplicateSignal): string {
  return SIGNAL_LABELS[signal];
}

export function normalizeComparableText(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

export function canonicalHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    const path = pathname === "/" ? "" : pathname;
    return `${parsed.protocol}//${hostname}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

function companyUrls(input: CompanyDuplicateInput): string[] {
  const urls = [
    canonicalHttpUrl(input.website),
    canonicalHttpUrl(input.careersUrl),
  ].filter((url): url is string => url !== null);
  return [...new Set(urls)];
}

function datesMatch(
  incoming: OpportunityDuplicateInput,
  existing: OpportunityDuplicateInput,
): boolean {
  const incomingPosted = incoming.postedOn?.trim() || null;
  const existingPosted = existing.postedOn?.trim() || null;
  const incomingDeadline = incoming.deadlineOn?.trim() || null;
  const existingDeadline = existing.deadlineOn?.trim() || null;
  if (incomingPosted !== existingPosted || incomingDeadline !== existingDeadline) {
    return false;
  }
  return incomingPosted !== null || incomingDeadline !== null;
}

export function matchCompanySignals(
  incoming: CompanyDuplicateInput,
  existing: CompanyDuplicateInput,
): DuplicateSignal[] {
  const signals: DuplicateSignal[] = [];
  const incomingName = normalizeComparableText(incoming.name);
  const existingName = normalizeComparableText(existing.name);
  if (incomingName.length > 0 && incomingName === existingName) {
    signals.push("same_name");
  }

  const incomingUrls = companyUrls(incoming);
  const existingUrls = new Set(companyUrls(existing));
  if (incomingUrls.some((url) => existingUrls.has(url))) {
    signals.push("same_url");
  }

  return signals;
}

export function matchOpportunitySignals(
  incoming: OpportunityDuplicateInput,
  existing: OpportunityDuplicateInput,
): DuplicateSignal[] {
  const signals: DuplicateSignal[] = [];
  const incomingUrl = canonicalHttpUrl(incoming.url);
  const existingUrl = canonicalHttpUrl(existing.url);
  if (incomingUrl && existingUrl && incomingUrl === existingUrl) {
    signals.push("same_url");
  }

  const incomingJobId = incoming.jobId?.trim() ?? "";
  const existingJobId = existing.jobId?.trim() ?? "";
  if (
    incoming.companyId === existing.companyId &&
    incomingJobId.length > 0 &&
    incomingJobId === existingJobId
  ) {
    signals.push("same_company_job_id");
  }

  const incomingLocation = normalizeComparableText(incoming.location);
  if (
    incoming.companyId === existing.companyId &&
    incomingLocation.length > 0 &&
    incomingLocation === normalizeComparableText(existing.location) &&
    normalizeComparableText(incoming.role) ===
      normalizeComparableText(existing.role) &&
    datesMatch(incoming, existing)
  ) {
    signals.push("same_company_role_location_dates");
  }

  return signals;
}

function isDuplicateSignal(value: unknown): value is DuplicateSignal {
  return (
    typeof value === "string" &&
    (DUPLICATE_SIGNALS as readonly string[]).includes(value)
  );
}

function isCandidate(value: unknown): value is DuplicateCandidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    (candidate.entityType === "company" ||
      candidate.entityType === "opportunity") &&
    typeof candidate.label === "string" &&
    typeof candidate.href === "string" &&
    Array.isArray(candidate.signals) &&
    candidate.signals.length > 0 &&
    candidate.signals.every(isDuplicateSignal)
  );
}

export function parseDuplicateConflict(
  status: number,
  body: unknown,
): DuplicateConflict | null {
  if (status !== 409 || typeof body !== "object" || body === null) {
    return null;
  }
  const value = body as Record<string, unknown>;
  if (typeof value.error !== "string" || !Array.isArray(value.candidates)) {
    return null;
  }
  if (!value.candidates.every(isCandidate)) {
    return null;
  }
  return {
    error: value.error,
    candidates: value.candidates,
  };
}

export function formatDuplicateCandidateReason(
  warning: string,
  candidates: DuplicateCandidate[],
): string {
  const named = candidates
    .map((candidate) => {
      const signals = candidate.signals
        .map((signal) => duplicateSignalLabel(signal))
        .join("; ");
      return `${candidate.label} (${signals})`;
    })
    .join("; ");
  return named.length > 0 ? `${warning} ${named}.` : warning;
}
