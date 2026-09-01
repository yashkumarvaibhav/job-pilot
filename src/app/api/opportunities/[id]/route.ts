import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  OpportunityInputError,
  getOpportunity,
  updateOpportunity,
} from "@/server/repos/opportunities";
import {
  opportunityResponse,
  readUpdateOpportunityInput,
} from "@/server/repos/opportunity-http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Opportunity not found" };
const INVALID_OPPORTUNITY = { error: "Enter valid opportunity details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getOpportunity(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(opportunityResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateOpportunityInput(request);
  if (!input) {
    return NextResponse.json(INVALID_OPPORTUNITY, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateOpportunity(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(opportunityResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof OpportunityInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PUT = write;
export const PATCH = write;
