import { NextResponse } from "next/server";

import { currentTenant } from "@/server/auth/current-session";
import { getDatabase } from "@/server/db/runtime";
import {
  confirmInboxMatch,
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
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).contactId !== "string" ||
    Object.keys(value).some((key) => key !== "contactId")
  ) {
    return NextResponse.json({ error: "Choose a suggested contact." }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const thread = confirmInboxMatch(
      getDatabase(),
      tenant,
      id,
      (value as { contactId: string }).contactId,
    );
    return thread
      ? NextResponse.json({ thread })
      : NextResponse.json({ error: "Inbox thread not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof InboxContentError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
