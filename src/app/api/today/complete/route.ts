import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { readConvertDerivedInput } from "@/server/repos/task-http";
import { completeDerivedDueItem } from "@/server/repos/tasks";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_SOURCE = { error: "Enter a due-source key." };
const NOT_FOUND = { error: "Follow-up not found" };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readConvertDerivedInput(request);
  if (!input) {
    return NextResponse.json(INVALID_SOURCE, { status: 400 });
  }
  const result = completeDerivedDueItem(getDatabase(), tenant, input);
  return result
    ? NextResponse.json(result)
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
