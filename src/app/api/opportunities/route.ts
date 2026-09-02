import { NextResponse } from "next/server";

import { calendarDateInZone } from "@/domain/referral";
import { DuplicateConflictError } from "@/domain/duplicate";
import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import {
  OpportunityInputError,
  createOpportunity,
  listOpportunities,
  parseOpportunityListFilter,
} from "@/server/repos/opportunities";
import {
  opportunityResponse,
  readCreateOpportunityInput,
} from "@/server/repos/opportunity-http";
import { duplicateConflictResponse } from "@/server/repos/duplicate-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_OPPORTUNITY = { error: "Enter valid opportunity details." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const filter = parseOpportunityListFilter(
    new URL(request.url).searchParams,
    calendarDateInZone(timeZone),
  );
  return NextResponse.json(
    listOpportunities(database, tenant, filter).map(opportunityResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateOpportunityInput(request);
  if (!input) {
    return NextResponse.json(INVALID_OPPORTUNITY, { status: 400 });
  }
  try {
    return NextResponse.json(
      opportunityResponse(createOpportunity(getDatabase(), tenant, input)),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof OpportunityInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof DuplicateConflictError) {
      return duplicateConflictResponse(error);
    }
    throw error;
  }
}
