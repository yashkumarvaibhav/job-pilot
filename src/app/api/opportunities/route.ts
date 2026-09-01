import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  OpportunityInputError,
  createOpportunity,
  listOpportunities,
  type OpportunityListFilter,
} from "@/server/repos/opportunities";
import {
  opportunityResponse,
  readCreateOpportunityInput,
} from "@/server/repos/opportunity-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_OPPORTUNITY = { error: "Enter valid opportunity details." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const value = new URL(request.url).searchParams.get("bucket") ?? "all";
  const filter: OpportunityListFilter =
    value === "saved" || value === "active" || value === "all" ? value : "all";
  return NextResponse.json(
    listOpportunities(getDatabase(), tenant, filter).map(opportunityResponse),
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
    throw error;
  }
}
