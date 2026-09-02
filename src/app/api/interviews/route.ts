import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  interviewResponse,
  readCreateInterviewInput,
} from "@/server/repos/interview-http";
import {
  InterviewInputError,
  createInterview,
  listInterviews,
} from "@/server/repos/interviews";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_INTERVIEW = { error: "Enter valid interview details." };
const OPPORTUNITY_NOT_FOUND = { error: "Opportunity not found" };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const opportunityId = new URL(request.url).searchParams.get("opportunityId");
  return NextResponse.json(
    listInterviews(
      getDatabase(),
      tenant,
      opportunityId && opportunityId.length > 0 ? opportunityId : undefined,
    ).map(interviewResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateInterviewInput(request);
  if (!input) {
    return NextResponse.json(INVALID_INTERVIEW, { status: 400 });
  }
  try {
    const created = createInterview(getDatabase(), tenant, input);
    return created
      ? NextResponse.json(interviewResponse(created), { status: 201 })
      : NextResponse.json(OPPORTUNITY_NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof InterviewInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
