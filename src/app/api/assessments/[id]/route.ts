import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  assessmentResponse,
  readUpdateAssessmentInput,
} from "@/server/repos/assessment-http";
import {
  AssessmentInputError,
  deleteAssessment,
  getAssessment,
  updateAssessment,
} from "@/server/repos/assessments";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Assessment not found" };
const INVALID_ASSESSMENT = { error: "Enter valid assessment details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getAssessment(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(assessmentResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateAssessmentInput(request);
  if (!input) {
    return NextResponse.json(INVALID_ASSESSMENT, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateAssessment(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(assessmentResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof AssessmentInputError) {
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
  return deleteAssessment(getDatabase(), tenant, id)
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
