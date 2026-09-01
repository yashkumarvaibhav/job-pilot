import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  readConvertDerivedInput,
  taskResponse,
} from "@/server/repos/task-http";
import { createTaskFromDerived } from "@/server/repos/tasks";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_SOURCE = { error: "Enter a due-source key." };
const NOT_FOUND = { error: "Due item not found" };

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readConvertDerivedInput(request);
  if (!input) {
    return NextResponse.json(INVALID_SOURCE, { status: 400 });
  }
  const created = createTaskFromDerived(getDatabase(), tenant, input);
  return created
    ? NextResponse.json(taskResponse(created), { status: 201 })
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
