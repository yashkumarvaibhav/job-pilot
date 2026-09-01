import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import { calendarDateInZone } from "@/domain/referral";
import {
  createReferral,
  listReferrals,
  parseReferralListFilter,
  ReferralInputError,
} from "@/server/repos/referrals";
import {
  readCreateReferralInput,
  referralResponse,
} from "@/server/repos/referral-http";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_REFERRAL = { error: "Enter valid referral details." };
const NOT_FOUND = { error: "Contact or opportunity not found" };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const filter = parseReferralListFilter(
    new URL(request.url).searchParams,
    calendarDateInZone(timeZone),
  );
  return NextResponse.json(
    listReferrals(database, tenant, filter).map(referralResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateReferralInput(request);
  if (!input) {
    return NextResponse.json(INVALID_REFERRAL, { status: 400 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  try {
    const created = createReferral(database, tenant, {
      ...input,
      todayOn: calendarDateInZone(timeZone),
    });
    return created
      ? NextResponse.json(referralResponse(created), { status: 201 })
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof ReferralInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
