import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  readUpdateTaskInput,
  taskResponse,
} from "@/server/repos/task-http";
import {
  getTask,
  TaskInputError,
  updateTask,
} from "@/server/repos/tasks";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };
const AUTHENTICATION_REQUIRED = { error: "Authentication required." };
const NOT_FOUND = { error: "Task not found" };
const INVALID_TASK = { error: "Enter valid task details." };

export async function GET(_request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const { id } = await context.params;
  const found = getTask(getDatabase(), tenant, id);
  return found
    ? NextResponse.json(taskResponse(found))
    : NextResponse.json(NOT_FOUND, { status: 404 });
}

async function write(request: Request, context: RouteContext) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json(AUTHENTICATION_REQUIRED, { status: 401 });
  }
  const input = await readUpdateTaskInput(request);
  if (!input) {
    return NextResponse.json(INVALID_TASK, { status: 400 });
  }
  try {
    const { id } = await context.params;
    const updated = updateTask(getDatabase(), tenant, id, input);
    return updated
      ? NextResponse.json(taskResponse(updated))
      : NextResponse.json(NOT_FOUND, { status: 404 });
  } catch (error) {
    if (error instanceof TaskInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export const PUT = write;
export const PATCH = write;
