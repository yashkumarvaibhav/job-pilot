import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { taskResponse } from "@/server/repos/task-http";
import { completeTask } from "@/server/repos/tasks";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Task not found" };

export async function POST(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const completed = completeTask(getDatabase(), tenant, id);
  return completed
    ? NextResponse.json(taskResponse(completed))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}
