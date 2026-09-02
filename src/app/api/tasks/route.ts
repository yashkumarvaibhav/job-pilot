import { NextResponse } from "next/server";

import { calendarDateInZone } from "@/domain/referral";
import { currentTenant } from "@/server/auth/current-session";
import { getWorkspaceSettings } from "@/server/db/foundation";
import { getDatabase } from "@/server/db/runtime";
import { DEFAULT_TIME_ZONE } from "@/server/db/timezone";
import {
  dueItemResponse,
  readCreateTaskInput,
  taskResponse,
} from "@/server/repos/task-http";
import {
  createTask,
  listTasks,
  parseTaskListFilter,
  TaskInputError,
} from "@/server/repos/tasks";
import { listTodayDueItems } from "@/server/repos/today";

export const runtime = "nodejs";

const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const INVALID_TASK = { error: "Enter valid task details." };

export async function GET(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const database = getDatabase();
  const timeZone =
    getWorkspaceSettings(database, tenant, tenant.workspaceId)?.timezone ??
    DEFAULT_TIME_ZONE;
  const asOfOn = calendarDateInZone(timeZone);
  const filter = parseTaskListFilter(
    new URL(request.url).searchParams,
    asOfOn,
  );
  if (filter.source === "followups") {
    return NextResponse.json(
      listTodayDueItems(database, tenant, asOfOn).map(dueItemResponse),
    );
  }
  return NextResponse.json(
    listTasks(database, tenant, filter).map(taskResponse),
  );
}

export async function POST(request: Request) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readCreateTaskInput(request);
  if (!input) {
    return NextResponse.json(INVALID_TASK, { status: 400 });
  }
  try {
    const created = createTask(getDatabase(), tenant, input);
    return NextResponse.json(taskResponse(created), { status: 201 });
  } catch (error) {
    if (error instanceof TaskInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
