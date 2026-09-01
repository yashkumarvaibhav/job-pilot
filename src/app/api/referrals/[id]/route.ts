import { NextResponse } from "next/server";

import { calendarDateInZone } from "@/domain/referral";
import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import {
  readUpdateReferralInput,
  referralResponse,
} from "@/server/repos/referral-http";
import {
  getReferral,
  ReferralInputError,
  updateReferral,
} from "@/server/repos/referrals";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Referral not found" };
const INVALID_REFERRAL = { error: "Enter valid referral details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getReferral(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(referralResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateReferralInput(request);
  if (!input) {
    return NextResponse.json(INVALID_REFERRAL, { status: 400 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  try {
    const { id } = await context.params;
    const updated = updateReferral(database, tenant, id, {
      ...input,
      todayOn: calendarDateInZone(timeZone),
    });
    return updated
      ? NextResponse.json(referralResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof ReferralInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PUT = write;
export const PATCH = write;
