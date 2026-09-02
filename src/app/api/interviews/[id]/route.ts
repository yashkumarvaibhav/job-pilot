import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  interviewResponse,
  readUpdateInterviewInput,
} from "@/server/repos/interview-http";
import {
  InterviewInputError,
  deleteInterview,
  getInterview,
  updateInterview,
} from "@/server/repos/interviews";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Interview not found" };
const INVALID_INTERVIEW = { error: "Enter valid interview details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getInterview(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(interviewResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateInterviewInput(request);
  if (!input) {
    return NextResponse.json(INVALID_INTERVIEW, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateInterview(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(interviewResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof InterviewInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PUT = write;
export const PATCH = write;

export async function DELETE(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  return deleteInterview(getDatabase(), tenant, id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
