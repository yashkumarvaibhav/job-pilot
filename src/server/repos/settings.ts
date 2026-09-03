import { eq } from "drizzle-orm";

import {
  normalizeProfileText,
  parseQuietHours,
  QuietHoursError,
  SETTINGS_PROFILE_MAX,
} from "../../domain/settings";
import {
  isScoringWeightInput,
  resolveScoringWeights,
  type ScoringWeights,
} from "../../domain/scoring";
import { logEvent } from "../db/activity";
import type { AppDatabase } from "../db/client";
import { settings } from "../db/schema";
import type { TenantContext } from "../db/tenant";
import { isValidIanaTimeZone } from "../db/timezone";

export type WorkspaceSettingsView = {
  displayName: string;
  university: string | null;
  timezone: string;
  quietStart: number | null;
  quietEnd: number | null;
  digestHour: number | null;
  scoringWeights: ScoringWeights;
  mutedNotificationKinds: string[];
};

export type UpdateWorkspaceSettingsInput = {
  displayName: string;
  university?: string | null;
  timezone?: string;
  quietStart?: string | null;
  quietEnd?: string | null;
  scoringWeights?: Partial<ScoringWeights>;
  now?: Date;
};

export class SettingsInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsInputError";
  }
}

/**
 * The session tenant is the only workspace key. A body that carries its own id is
 * refused outright rather than ignored, so a mistaken client hears about it (D-035).
 */
const ALLOWED_INPUT_KEYS = new Set<string>([
  "displayName",
  "university",
  "timezone",
  "quietStart",
  "quietEnd",
  "scoringWeights",
  "now",
]);

function toView(row: typeof settings.$inferSelect): WorkspaceSettingsView {
  return {
    displayName: row.displayName,
    university: row.university ?? null,
    timezone: row.timezone,
    quietStart: row.quietStart ?? null,
    quietEnd: row.quietEnd ?? null,
    digestHour: row.digestHour ?? null,
    scoringWeights: resolveScoringWeights(row.scoringWeightsJson),
    mutedNotificationKinds: row.mutedNotificationKindsJson ?? [],
  };
}

export function readWorkspaceSettings(
  database: AppDatabase,
  tenant: TenantContext,
): WorkspaceSettingsView {
  const row = database
    .select()
    .from(settings)
    .where(eq(settings.workspaceId, tenant.workspaceId))
    .get();
  if (!row) {
    throw new SettingsInputError("This workspace has no settings row.");
  }
  return toView(row);
}

function boundedProfileText(value: string, label: string): string {
  const normalized = normalizeProfileText(value);
  if (normalized.length > SETTINGS_PROFILE_MAX) {
    throw new SettingsInputError(
      `${label} must be ${SETTINGS_PROFILE_MAX} characters or fewer.`,
    );
  }
  return normalized;
}

export function updateWorkspaceSettings(
  database: AppDatabase,
  tenant: TenantContext,
  input: UpdateWorkspaceSettingsInput,
): WorkspaceSettingsView {
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new SettingsInputError(`Settings do not accept ${key}.`);
    }
  }

  const now = input.now ?? new Date();

  return database.transaction((transaction) => {
    const before = transaction
      .select()
      .from(settings)
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .get();
    if (!before) {
      throw new SettingsInputError("This workspace has no settings row.");
    }

    const displayName = boundedProfileText(input.displayName, "Display name");
    if (displayName.length === 0) {
      throw new SettingsInputError("Display name is required.");
    }
    // Absent means keep; an empty string is a deliberate clear.
    const university =
      input.university === undefined
        ? (before.university ?? "")
        : boundedProfileText(input.university ?? "", "University");

    // An omitted zone keeps the saved one; an empty one is a typo, not a reset.
    const timezone = (input.timezone ?? before.timezone).trim();
    if (!isValidIanaTimeZone(timezone)) {
      throw new SettingsInputError(
        `${timezone.length > 0 ? timezone : "That"} is not an IANA timezone name.`,
      );
    }

    let quiet: { quietStart: number | null; quietEnd: number | null };
    if (input.quietStart === undefined && input.quietEnd === undefined) {
      quiet = {
        quietStart: before.quietStart ?? null,
        quietEnd: before.quietEnd ?? null,
      };
    } else {
      try {
        quiet = parseQuietHours({
          start: input.quietStart,
          end: input.quietEnd,
        });
      } catch (error) {
        if (error instanceof QuietHoursError) {
          throw new SettingsInputError(error.message);
        }
        throw error;
      }
    }

    if (
      input.scoringWeights !== undefined &&
      !isScoringWeightInput(input.scoringWeights)
    ) {
      throw new SettingsInputError(
        "Scoring weights must be named whole numbers.",
      );
    }
    const beforeScoringWeights = resolveScoringWeights(
      before.scoringWeightsJson,
    );
    const scoringWeights = {
      ...beforeScoringWeights,
      ...(input.scoringWeights ?? {}),
    };

    const row = transaction
      .update(settings)
      .set({
        displayName,
        university: university.length > 0 ? university : null,
        timezone,
        quietStart: quiet.quietStart,
        quietEnd: quiet.quietEnd,
        scoringWeightsJson: scoringWeights,
      })
      .where(eq(settings.workspaceId, tenant.workspaceId))
      .returning()
      .get();

    if (before.timezone !== timezone) {
      logEvent(transaction, tenant, {
        at: now,
        kind: "SETTINGS_TIMEZONE_CHANGED",
        entityType: "workspace",
        entityId: tenant.workspaceId,
        payload: { from: before.timezone, to: timezone },
      });
    }


    const changedScoringTerms = Object.keys(scoringWeights).filter(
      (key) =>
        scoringWeights[key as keyof ScoringWeights] !==
        beforeScoringWeights[key as keyof ScoringWeights],
    );
    if (changedScoringTerms.length > 0) {
      logEvent(transaction, tenant, {
        at: now,
        kind: "SETTINGS_SCORING_WEIGHTS_CHANGED",
        entityType: "workspace",
        entityId: tenant.workspaceId,
        payload: { terms: changedScoringTerms.sort() },
      });
    }

    return toView(row);
  });
}
