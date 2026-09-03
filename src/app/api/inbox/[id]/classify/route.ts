import { NextResponse } from "next/server";

import { isReplyClassification } from "@/domain/reply-classification";
import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  classifyInboxReply,
  InboxContentError,
} from "@/server/repos/inbox-content";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const tenant = await currentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    value = null;
  }
  const classification =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).classification
      : null;
  if (
    !isReplyClassification(classification) ||
    Object.keys(value as object).some((key) => key !== "classification")
  ) {
    return NextResponse.json(
      { error: "Choose a valid reply classification." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  try {
    const message = classifyInboxReply(
      getDatabase(),
      tenant,
      id,
      classification,
    );
    return message
      ? NextResponse.json({ message })
      : NextResponse.json({ error: "Inbox thread not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof InboxContentError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
