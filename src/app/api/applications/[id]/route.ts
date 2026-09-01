import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  ApplicationInputError,
  getApplication,
  updateApplication,
} from "@/server/repos/applications";
import {
  applicationResponse,
  readUpdateApplicationInput,
} from "@/server/repos/application-http";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Application not found" };
const INVALID_APPLICATION = { error: "Enter valid application details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getApplication(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(applicationResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateApplicationInput(request);
  if (!input) {
    return NextResponse.json(INVALID_APPLICATION, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateApplication(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(applicationResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof ApplicationInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PUT = write;
export const PATCH = write;
