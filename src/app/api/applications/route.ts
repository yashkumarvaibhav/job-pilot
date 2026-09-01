import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ApplicationInputError,
  applyToOpportunity,
  listApplications,
} from "@/server/repos/applications";
import {
  applicationResponse,
  readApplyInput,
} from "@/server/repos/application-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_APPLICATION = { error: "Enter valid application details." };
const OPPORTUNITY_NOT_FOUND = { error: "Opportunity not found" };

export async function GET() {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  return NextResponse.json(
    listApplications(getDatabase(), tenant).map(applicationResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readApplyInput(request);
  if (!input) {
    return NextResponse.json(INVALID_APPLICATION, { status: 400 });
  }
  try {
    const created = applyToOpportunity(getDatabase(), tenant, input);
    return created
      ? NextResponse.json(applicationResponse(created), { status: 201 })
      : NextResponse.json(OPPORTUNITY_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof ApplicationInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
