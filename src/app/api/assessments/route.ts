import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  assessmentResponse,
  readCreateAssessmentInput,
} from "@/server/repos/assessment-http";
import {
  AssessmentInputError,
  createAssessment,
  listAssessments,
} from "@/server/repos/assessments";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_ASSESSMENT = { error: "Enter valid assessment details." };
const OPPORTUNITY_NOT_FOUND = { error: "Opportunity not found" };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const opportunityId = new URL(request.url).searchParams.get("opportunityId");
  return NextResponse.json(
    listAssessments(
      getDatabase(),
      tenant,
      opportunityId && opportunityId.length > 0 ? opportunityId : undefined,
    ).map(assessmentResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateAssessmentInput(request);
  if (!input) {
    return NextResponse.json(INVALID_ASSESSMENT, { status: 400 });
  }
  try {
    const created = createAssessment(getDatabase(), tenant, input);
    return created
      ? NextResponse.json(assessmentResponse(created), { status: 201 })
      : NextResponse.json(OPPORTUNITY_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof AssessmentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
