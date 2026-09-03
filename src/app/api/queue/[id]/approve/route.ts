import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  SendSafetyError,
  approveQueueMessage,
  parseWorkspaceSendAt,
} from "@/server/repos/send-safety";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = null;
  }
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "sendAt") ||
    !("sendAt" in input) ||
    typeof input.sendAt !== "string"
  ) {
    return NextResponse.json(
      { error: "Approve one queue id with one exact send time." },
      { status: 400 },
    );
  }
  try {
    const database = getDatabase();
    const sendAt = parseWorkspaceSendAt(database, tenant, input.sendAt);
    const row = approveQueueMessage(
      database,
      tenant,
      (await context.params).id,
      { sendAt },
    );
    return row
      ? NextResponse.json(row)
      : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof SendSafetyError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
