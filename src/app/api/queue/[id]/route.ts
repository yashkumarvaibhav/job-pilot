import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import { flushSendQueue } from "@/server/jobs/send-queue";
import { getMailSendDependencies } from "@/server/mail/runtime";
import { listVersionChoices } from "@/server/repos/documents";
import {
  SendSafetyError,
  approveQueueMessage,
  getQueueMessage,
  setQueueMessageState,
} from "@/server/repos/send-safety";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const row = getQueueMessage(getDatabase(), tenant, (await context.params).id);
  const attachments = row
    ? listVersionChoices(getDatabase(), tenant)
        .filter((version) => row.attachmentVersionIdsJson.includes(version.id))
        .map((version) => ({ id: version.id, name: version.displayName }))
    : [];
  return row
    ? NextResponse.json({ ...row, attachments })
    : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
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
    Object.keys(input).some((key) => key !== "action") ||
    !("action" in input) ||
    input.action !== "hold" &&
    input.action !== "cancel" &&
    input.action !== "send_now"
  ) {
    return NextResponse.json({ error: "Choose send now, hold or cancel for one queue row." }, { status: 400 });
  }
  try {
    const database = getDatabase();
    const id = (await context.params).id;
    let row;
    if (input.action === "send_now") {
      const dependencies = getMailSendDependencies();
      if (!dependencies) {
        return NextResponse.json(
          { error: "Gmail sending is not configured yet." },
          { status: 503 },
        );
      }
      const now = new Date();
      row = approveQueueMessage(database, tenant, id, { sendAt: now, now });
      if (row) {
        await flushSendQueue(database, dependencies, {
          now,
          maxSends: 1,
          onlyQueueId: id,
        });
        row = getQueueMessage(database, tenant, id);
      }
    } else {
      row = setQueueMessageState(database, tenant, id, input.action, new Date());
    }
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
