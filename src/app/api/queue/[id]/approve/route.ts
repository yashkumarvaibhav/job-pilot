import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  jsonObject,
  sequenceErrorStatus,
  sequenceOverrideRejected,
} from "@/server/repos/sequence-http";
import {
  SequenceError,
  getSequenceReview,
  saveSequenceReview,
} from "@/server/repos/sequences";
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
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = null;
  }
  const input = jsonObject(raw);
  if (!input || typeof input.sendAt !== "string") {
    return NextResponse.json(
      { error: "Approve one queue id with one exact send time." },
      { status: 400 },
    );
  }
  const database = getDatabase();
  const id = (await context.params).id;
  const review = getSequenceReview(database, tenant, id);
  if (review) {
    const rejected = sequenceOverrideRejected(Object.keys(input));
    if (rejected) {
      return NextResponse.json({ error: rejected.message }, { status: 409 });
    }
    try {
      const sendAt = parseWorkspaceSendAt(database, tenant, input.sendAt);
      const row = saveSequenceReview(database, tenant, id, {
        sendAt,
        approve: true,
        requestKeys: Object.keys(input),
      });
      return row
        ? NextResponse.json(row)
        : NextResponse.json({ error: "Queue row not found." }, { status: 404 });
    } catch (error) {
      if (error instanceof SequenceError) {
        return NextResponse.json(
          { error: error.message },
          { status: sequenceErrorStatus(error) },
        );
      }
      if (error instanceof SendSafetyError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  }
  if (
    Object.keys(input).some(
      (key) => key !== "sendAt" && key !== "uncertainDeliveryAcknowledged",
    ) ||
    ("uncertainDeliveryAcknowledged" in input &&
      typeof input.uncertainDeliveryAcknowledged !== "boolean")
  ) {
    return NextResponse.json(
      { error: "Approve one queue id with one exact send time." },
      { status: 400 },
    );
  }
  try {
    const sendAt = parseWorkspaceSendAt(database, tenant, input.sendAt);
    const row = approveQueueMessage(database, tenant, id, {
      sendAt,
      uncertainDeliveryAcknowledged:
        "uncertainDeliveryAcknowledged" in input &&
        input.uncertainDeliveryAcknowledged === true,
    });
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
